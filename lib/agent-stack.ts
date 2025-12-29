import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as efs from "aws-cdk-lib/aws-efs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { CF_PREFIX } from "./constants";

export enum AgentType {
  Relayer = "relayer",
  Validator = "validator",
}

export interface AgentStackProps extends cdk.StackProps {
  /** A unique identifier for the agent (e.g., "validator-evm-1", "relayer-cosmos") */
  uniqueId: string;

  /** The type of the agent */
  agentType: AgentType;

  /**
   * ECR repository URI for the agent container image
   * Example: "123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperlane-agents"
   */
  ecrRepositoryUri: string;

  /**
   * S3 bucket ARN for validator signatures
   * Example: "arn:aws:s3:::hyperlane-signatures"
   */
  bucketArn: string;

  /**
   * Environment variables for the agent container
   * Example (for relayer): { HYP_RELAYCHAINS: 'ethtest,sovstarter' }
   */
  environment?: { [key: string]: string };
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

    const { uniqueId, agentType, ecrRepositoryUri, bucketArn } = props;

    // Import VPC from BaseAccountStack
    const vpcId = cdk.Fn.importValue(`${CF_PREFIX}-VpcId`);
    const availabilityZones = cdk.Fn.split(
      ",",
      cdk.Fn.importValue(`${CF_PREFIX}-VpcAzs`),
    );
    const privateSubnetIds = cdk.Fn.split(
      ",",
      cdk.Fn.importValue(`${CF_PREFIX}-PrivateSubnetIds`),
    );

    // Import VPC Cluster from BaseAccountStack
    this.vpc = ec2.Vpc.fromVpcAttributes(this, "Vpc", {
      vpcId,
      availabilityZones,
      privateSubnetIds,
    });

    // Import ECS Cluster from BaseAccountStack
    const clusterName = cdk.Fn.importValue(`${CF_PREFIX}-ClusterName`);
    const clusterArn = cdk.Fn.importValue(`${CF_PREFIX}-ClusterArn`);

    this.cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName,
      clusterArn,
      vpc: this.vpc,
      securityGroups: [],
    });

    // Import EFS from BaseAccountStack
    const efsId = cdk.Fn.importValue(`${CF_PREFIX}-EfsId`);
    const efsSecurityGroupId = cdk.Fn.importValue(
      `${CF_PREFIX}-EfsSecurityGroupId`,
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

    const accessPoint = new efs.AccessPoint(this, "AccessPoint", {
      fileSystem: this.fileSystem,
      path: `/${uniqueId}`,
      createAcl: {
        ownerGid: "1000",
        ownerUid: "1000",
        permissions: "755",
      },
      posixUser: {
        gid: "1000",
        uid: "1000",
      },
    });

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

    // Create KMS key for validators
    if (agentType === AgentType.Validator) {
      this.validatorKey = new kms.Key(this, "SigningKey", {
        description: `Signing key for Hyperlane validator ${uniqueId}`,
        alias: uniqueId,
        // validators always use EVM compatible keys regardless of blockchain network
        keySpec: kms.KeySpec.ECC_SECG_P256K1,
        keyUsage: kms.KeyUsage.SIGN_VERIFY,
        // never rotate to maintain signature validity
        enableKeyRotation: false,
        // retain key on stack deletion to be safe
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      // Grant the task role permission to use the key
      this.validatorKey.grantEncryptDecrypt(this.taskRole);
    }

    const bucket = s3.Bucket.fromBucketArn(this, "SignaturesBucket", bucketArn);

    // Grant S3 permissions (works for both same-account and cross-account)
    // Only validator needs write access
    bucket.grantRead(this.taskRole);
    if (agentType === AgentType.Validator) {
      bucket.grantWrite(this.taskRole);
    }

    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/ecs/hyperlane/${agentType}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: probably keep this based on network
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 1024,
      cpu: 512,
      executionRole,
      taskRole: this.taskRole,
    });

    taskDefinition.addVolume({
      name: "agent-data",
      efsVolumeConfiguration: {
        fileSystemId: this.fileSystem.fileSystemId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: "ENABLED",
        },
      },
    });

    const dbPath = "/data";
    const environment: { [key: string]: string } = {
      ...(props.environment ?? {}),
      HYP_DB: dbPath,
      NO_COLOR: "1",
    };

    if (agentType === AgentType.Validator) {
      // validator key, KMS always prefixes alias with "alias/*"
      environment.HYP_VALIDATOR_TYPE = "aws";
      environment.HYP_VALIDATOR_ID = `alias/${uniqueId}`;

      // s3 bucket
      environment.HYP_CHECKPOINTSYNCER_TYPE = "s3";
      environment.HYP_CHECKPOINTSYNCER_BUCKET = bucket.bucketName;
      environment.HYP_CHECKPOINTSYNCER_FOLDER = uniqueId;
    }

    const containerConfig: ecs.ContainerDefinitionOptions = {
      image: ecs.ContainerImage.fromRegistry(ecrRepositoryUri),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: uniqueId,
        logGroup,
      }),
      environment,
      command: [`./${agentType}`],
      healthCheck: {
        command: ["CMD-SHELL", `pgrep -f ${agentType} || exit 1`],
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

    container.addMountPoints({
      sourceVolume: "agent-data",
      containerPath: dbPath,
      readOnly: false,
    });

    // Inject wallet signer keys from secrets manager
    // Only access the keys the relayer is relaying
    if (agentType === AgentType.Relayer) {
      // This env var should always exist for relayers
      const chains = environment["HYP_RELAYCHAINS"].split(",");

      for (const chain of chains) {
        const envVar = `HYP_CHAINS_${chain.toUpperCase()}_SIGNER_KEY`;
        const secret = secretsmanager.Secret.fromSecretNameV2(
          this,
          `SignerKeySecret-${chain}`,
          `hyperlane/${chain}-wallet`,
        );
        container.addSecret(envVar, ecs.Secret.fromSecretsManager(secret));
      }
    }

    this.service = new ecs.FargateService(this, "Service", {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1,
      serviceName: uniqueId,
      enableExecuteCommand: true,
      // Ensure only 1 task runs at a time to prevent database locking issues
      // This will incur downtime during deployments
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    });

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
