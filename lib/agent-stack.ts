import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Annotations } from "aws-cdk-lib/core";
import { Construct } from "constructs";

export enum AgentType {
  Relayer = "relayer",
  Validator = "validator",
}

export interface AgentStackProps extends cdk.StackProps {
  /** A unique identifier for the agent (e.g., "validator-evm-1", "relayer-cosmos") */
  uniqueId: string;

  /** The type of the agent */
  agentType: AgentType;

  /** ECS Cluster to deploy the agent in (contains VPC reference) */
  cluster: ecs.ICluster;

  /** EFS file system for persistent storage */
  fileSystem: efs.IFileSystem;

  /** Security group for EFS access */
  efsSecurityGroup: ec2.ISecurityGroup;

  /** ECR repository containing the agent image */
  repository: ecr.IRepository;

  /** S3 bucket for validator signatures */
  bucket: s3.IBucket;

  /** KMS key alias for validator signing (only for Validator agents) */
  validatorKey?: kms.IAlias;

  /**
   * Whether to grant the validator access to the wallet private keys. (only for Validator agents).
   *
   * Validators need access to funds to perform their "Validator Announcement" transaction.
   * Long term, this should be done by us to avoid the validator having access to wallets for a once-off tx.
   * For now, we grant access to the validator task role.
   *
   * Requires the wallet secret to exist in the account running the validator - typically we only deploy wallet secrets
   * to the "core" accounts that are running relayers.
   **/
  validatorWalletAccess?: boolean;

  /**
   * Environment variables for the agent container
   * Example (for relayer): { HYP_RELAYCHAINS: 'ethtest,sovstarter' }
   */
  environment?: { [key: string]: string };
}

export class AgentStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly taskRole: iam.Role;
  public readonly validatorKey?: kms.Key;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const {
      uniqueId,
      agentType,
      cluster,
      fileSystem,
      efsSecurityGroup,
      repository,
      bucket,
      validatorKey,
      validatorWalletAccess,
    } = props;

    const accessPoint = new efs.AccessPoint(this, "AccessPoint", {
      fileSystem,
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
      roleName: `hyperlane-${uniqueId}-task-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: `Role for Hyperlane ${agentType} to access AWS resources`,
    });

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
        fileSystemId: fileSystem.fileSystemId,
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

    const containerConfig: ecs.ContainerDefinitionOptions = {
      image: ecs.ContainerImage.fromEcrRepository(repository),
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

    if (agentType === AgentType.Validator) {
      // We can't throw a error here because it causes the hyperlane app stack to fail
      // to synth if we haven't created the validators key yet - which will be the case a lot of the time
      // since they're in the same CDK app.
      if (validatorKey) {
        validatorKey.grantSignVerify(this.taskRole);
        environment.HYP_VALIDATOR_TYPE = "aws";
        environment.HYP_VALIDATOR_ID = validatorKey.aliasName;
      } else {
        Annotations.of(this).addWarningV2(
          "sov:MissingValidatorKey",
          "Deploying a validator without a key, agent will fail at runtime.",
        );
      }

      if (validatorWalletAccess) {
        const chain = environment["HYP_ORIGINCHAINNAME"];
        const envVar = `HYP_CHAINS_${chain.toUpperCase()}_SIGNER_KEY`;

        // Grant access to wallet private keys stored in Secrets Manager
        const secret = secretsmanager.Secret.fromSecretNameV2(
          this,
          `SignerKeySecret-${chain}`,
          `hyperlane/${chain}/wallet`,
        );

        secret.grantRead(executionRole);
        container.addSecret(envVar, ecs.Secret.fromSecretsManager(secret));
      }

      // s3 bucket
      environment.HYP_CHECKPOINTSYNCER_TYPE = "s3";
      environment.HYP_CHECKPOINTSYNCER_BUCKET = bucket.bucketName;
      environment.HYP_CHECKPOINTSYNCER_FOLDER = uniqueId;
    }

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
          `hyperlane/${chain}/wallet`,
        );

        secret.grantRead(executionRole);
        container.addSecret(envVar, ecs.Secret.fromSecretsManager(secret));
      }
    }

    this.service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      serviceName: uniqueId,
      enableExecuteCommand: true,
      // Ensure only 1 task runs at a time to prevent database locking issues
      // This will incur downtime during deployments
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    });

    // Allow ECS tasks to access EFS on port 2049 (NFS)
    // Add rule to service's security group instead of EFS security group
    // to avoid circular dependency between stacks
    this.service.connections.allowTo(efsSecurityGroup, ec2.Port.NFS);

    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
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
      });

      new cdk.CfnOutput(this, "SigningKeyId", {
        value: this.validatorKey.keyId,
        description: "KMS signing key ID for validator",
      });
    }
  }
}
