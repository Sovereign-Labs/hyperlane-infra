import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as efs from "aws-cdk-lib/aws-efs";
import * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

export enum AgentType {
  Relayer = "relayer",
  Validator = "validator",
}

export interface AgentStackProps extends cdk.StackProps {
  /**
   * Account name for auto-discovery of base infrastructure
   * Must match the accountName used in BaseAccountStack
   * Example: "validator1", "validator2", "sovereign-testnet"
   */
  accountName: string;

  /**
   * Core account name for cross-account access (ECR/S3)
   * Only required if this agent is deployed in a different account than storage
   * If not provided, assumes same-account deployment (accountName has the storage)
   * Example: "sovereign-testnet" when deploying to "customer1-testnet"
   */
  coreAccountName?: string;

  /** A unique identifier for the agent (e.g., "validator-evm-1", "relayer-cosmos") */
  uniqueId: string;

  /** The type of the agent */
  agentType: AgentType;

  /**
   * Environment variables for the agent container
   * Example: { HYP_CHAINS: 'ethereum,polygon', HYP_DB: '/data/relayer-1/db' }
   */
  environment?: { [key: string]: string };

  /**
   * CPU units for the Fargate task (256, 512, 1024, 2048, 4096)
   * Default: 512 (0.5 vCPU)
   */
  cpu?: number;

  /**
   * Memory in MB for the Fargate task (512, 1024, 2048, 3072, 4096, etc.)
   * Must be compatible with CPU value
   * Default: 1024 (1 GB)
   */
  memory?: number;

  /**
   * Number of agent tasks to run
   * Default: 1
   */
  desiredCount?: number;
}

export class AgentStack extends cdk.Stack {
  public readonly cluster: ecs.ICluster;
  public readonly service: ecs.FargateService;
  public readonly taskRole: iam.Role;
  public readonly fileSystem: efs.IFileSystem;
  public readonly vpc: ec2.IVpc;
  public readonly validatorKey?: kms.Key;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const { uniqueId, accountName, agentType } = props;

    // Determine which account has the storage (ECR/S3)
    const storageAccountName = props.coreAccountName || accountName;

    // Auto-discover ECR repository URI and S3 bucket ARN from CloudFormation exports
    const ecrRepositoryUri = cdk.Fn.importValue(
      `Hyperlane-${storageAccountName}-RepositoryUri`,
    );
    const bucketArn = cdk.Fn.importValue(
      `Hyperlane-${storageAccountName}-BucketArn`,
    );

    // Import VPC from BaseAccountStack
    const vpcId = cdk.Fn.importValue(`Hyperlane-${accountName}-VpcId`);
    const availabilityZones = cdk.Fn.split(
      ",",
      cdk.Fn.importValue(`Hyperlane-${accountName}-VpcAzs`),
    );
    const privateSubnetIds = cdk.Fn.split(
      ",",
      cdk.Fn.importValue(`Hyperlane-${accountName}-PrivateSubnetIds`),
    );

    this.vpc = ec2.Vpc.fromVpcAttributes(this, "Vpc", {
      vpcId,
      availabilityZones,
      privateSubnetIds,
    });

    // Import ECS Cluster from BaseAccountStack
    const clusterName = cdk.Fn.importValue(
      `Hyperlane-${accountName}-ClusterName`,
    );
    const clusterArn = cdk.Fn.importValue(
      `Hyperlane-${accountName}-ClusterArn`,
    );

    this.cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName,
      clusterArn,
      vpc: this.vpc,
      securityGroups: [],
    });

    // Import EFS from BaseAccountStack
    const efsId = cdk.Fn.importValue(`Hyperlane-${accountName}-EfsId`);
    const efsSecurityGroupId = cdk.Fn.importValue(
      `Hyperlane-${accountName}-EfsSecurityGroupId`,
    );

    this.fileSystem = efs.FileSystem.fromFileSystemAttributes(
      this,
      "FileSystem",
      {
        fileSystemId: efsId,
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "EfsSecurityGroup",
          efsSecurityGroupId,
        ),
      },
    );

    // Task execution role - used by ECS to pull images and write logs
    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    // Task role - used by the container itself to access AWS resources
    this.taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: `Role for Hyperlane ${agentType} to access AWS resources`,
    });

    // Create KMS key for validators (used for signing messages)
    if (agentType === AgentType.Validator) {
      this.validatorKey = new kms.Key(this, "SigningKey", {
        description: `Signing key for Hyperlane validator ${uniqueId}`,
        removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain key on stack deletion for security
        alias: `hyperlane-validator-${uniqueId}`,
      });

      // Grant the task role permission to use the key
      this.validatorKey.grantEncryptDecrypt(this.taskRole);
    }

    const bucket = s3.Bucket.fromBucketArn(this, "SignaturesBucket", bucketArn);

    // Grant S3 permissions (works for both same-account and cross-account)
    // For cross-account, this adds IAM policies on the task role
    // The bucket policy in the main account allows the access
    bucket.grantRead(this.taskRole);
    if (agentType === AgentType.Validator) {
      bucket.grantWrite(this.taskRole);
    }

    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/ecs/hyperlane-${agentType}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: props.memory || 1024,
      cpu: props.cpu || 512,
      executionRole,
      taskRole: this.taskRole,
    });

    // Add EFS volume to task definition - used for local databases
    taskDefinition.addVolume({
      name: "agent-data",
      efsVolumeConfiguration: {
        fileSystemId: this.fileSystem.fileSystemId,
        rootDirectory: `/${uniqueId}`,
      },
    });

    const baseEnvironment = props.environment || {};

    // Add HYP_DB path for all agents
    const environment: { [key: string]: string } = {
      ...baseEnvironment,
      HYP_DB: `/data/${uniqueId}/db`,
    };

    // Add KMS key alias for validators
    if (agentType === AgentType.Validator) {
      environment.HYP_VALIDATOR_TYPE = "aws";
      environment.HYP_VALIDATOR_ID = `alias/hyperlane-validator-${uniqueId}`;
    }

    const containerConfig: ecs.ContainerDefinitionOptions = {
      image: ecs.ContainerImage.fromRegistry(ecrRepositoryUri),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: agentType,
        logGroup,
      }),
      environment,
      command: [`./${agentType}`],
      healthCheck: {
        command: [
          "CMD-SHELL",
          "curl -f http://localhost:9090/metrics || exit 1",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    };

    const container = taskDefinition.addContainer("Container", containerConfig);

    // Metrics port (Prometheus endpoint)
    container.addPortMappings({
      containerPort: 9090,
      protocol: ecs.Protocol.TCP,
    });

    // Mount the EFS volume in the container
    // Each agent should use a different subdirectory via HYP_DB env var
    // e.g., HYP_DB=/data/validator-evm-1/db
    container.addMountPoints({
      sourceVolume: "agent-data",
      containerPath: "/data",
      readOnly: false,
    });

    // Create Fargate service
    this.service = new ecs.FargateService(this, "Service", {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: props.desiredCount || 1,
      serviceName: `hyperlane-${agentType}`,
      enableExecuteCommand: true,
    });

    this.fileSystem.grantRootAccess(
      this.service.taskDefinition.taskRole.grantPrincipal,
    );
    this.fileSystem.connections.allowDefaultPortFrom(this.service.connections);

    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: "ECS Cluster name",
    });

    new cdk.CfnOutput(this, "ServiceName", {
      value: this.service.serviceName,
      description: "ECS Service name",
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
      description: "CloudWatch Log Group",
    });

    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.fileSystem.fileSystemId,
      description: "EFS File System ID",
      exportName: `Hyperlane-${agentType}-FileSystemId`,
    });

    // Output KMS key ARN for validators
    if (this.validatorKey) {
      new cdk.CfnOutput(this, "SigningKeyArn", {
        value: this.validatorKey.keyArn,
        description: "KMS signing key ARN for validator",
        exportName: `Hyperlane-Validator-${uniqueId}-SigningKeyArn`,
      });

      new cdk.CfnOutput(this, "SigningKeyId", {
        value: this.validatorKey.keyId,
        description: "KMS signing key ID for validator",
      });
    }
  }
}
