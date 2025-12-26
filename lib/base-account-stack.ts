import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface BaseAccountStackProps extends cdk.StackProps {
  /**
   * A unique identifier for this account (e.g., "validator1", "validator2", "main")
   * Used for consistent naming across stacks
   */
  accountName: string;

  /**
   * Maximum number of Availability Zones to use
   * Default: 2
   */
  maxAzs?: number;

  /**
   * Number of NAT Gateways (1 = cost optimized, 2+ = high availability)
   * Default: 1
   */
  natGateways?: number;

  /**
   * Enable VPC endpoints to reduce data transfer costs
   * Recommended: true for production
   * Default: false
   */
  enableVpcEndpoints?: boolean;
}

/**
 * Base infrastructure stack for a single AWS account
 *
 * Creates shared infrastructure for all Hyperlane agents in an account:
 * - VPC with public/private subnets (will be used for VPC peering)
 * - ECS Cluster (shared by all agents)
 * - EFS file system (shared storage for all agents)
 * - Security groups
 * - VPC endpoints (optional)
 *
 * This stack should be deployed ONCE per AWS account.
 * Multiple validator sets can then reference these resources via CloudFormation imports.
 *
 * Naming Convention:
 * - VPC: hyperlane-{accountName}-vpc
 * - ECS Cluster: hyperlane-{accountName}-cluster
 * - EFS: hyperlane-{accountName}-efs
 * - EFS Security Group: hyperlane-{accountName}-efs-sg
 *
 * CloudFormation Exports:
 * - Hyperlane-{accountName}-VpcId
 * - Hyperlane-{accountName}-VpcCidr
 * - Hyperlane-{accountName}-VpcAzs
 * - Hyperlane-{accountName}-PrivateSubnetIds
 * - Hyperlane-{accountName}-PublicSubnetIds
 * - Hyperlane-{accountName}-ClusterName
 * - Hyperlane-{accountName}-ClusterArn
 * - Hyperlane-{accountName}-EfsId
 * - Hyperlane-{accountName}-EfsSecurityGroupId
 */
export class BaseAccountStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly fileSystem?: efs.FileSystem;
  public readonly efsSecurityGroup?: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: BaseAccountStackProps) {
    super(scope, id, props);

    const { accountName } = props;

    // ========================================================================
    // VPC
    // ========================================================================

    const subnetConfiguration: ec2.SubnetConfiguration[] = [
      {
        name: "Public",
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      },
      {
        name: "Private",
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: 24,
      },
    ];

    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `hyperlane-${accountName}-vpc`,
      maxAzs: props.maxAzs || 2,
      natGateways: props.natGateways || 1,
      subnetConfiguration,
    });

    // VPC endpoints (optional, reduces data transfer costs)
    if (props.enableVpcEndpoints) {
      // S3 Gateway Endpoint (free)
      this.vpc.addGatewayEndpoint("S3Endpoint", {
        service: ec2.GatewayVpcEndpointAwsService.S3,
      });

      // ECR endpoints (for pulling Docker images without NAT)
      this.vpc.addInterfaceEndpoint("EcrEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.ECR,
      });

      this.vpc.addInterfaceEndpoint("EcrDockerEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      });

      // CloudWatch Logs endpoint
      this.vpc.addInterfaceEndpoint("CloudWatchLogsEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      });

      // Secrets Manager endpoint (if using for RPC URLs, etc.)
      this.vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      });
    }

    // ========================================================================
    // ECS Cluster (shared by all agents in this account)
    // ========================================================================

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: this.vpc,
      clusterName: `hyperlane-${accountName}-cluster`,
      containerInsights: true,
    });

    // ========================================================================
    // EFS File System (shared storage for all agents)
    // ========================================================================

    // manually created so we can export it and use in other stacks
    this.efsSecurityGroup = new ec2.SecurityGroup(this, "EfsSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: `hyperlane-${accountName}-efs-sg`,
      description: `Security group for Hyperlane EFS in ${accountName}`,
    });

    this.fileSystem = new efs.FileSystem(this, "FileSystem", {
      vpc: this.vpc,
      fileSystemName: `hyperlane-${accountName}-efs`,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add file system policy to allow mounting from any task in the VPC
    // Can probably use IAM assumed role controls here, but this is simpler
    // and effective enough for our use case
    this.fileSystem.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientRootAccess",
          "elasticfilesystem:ClientWrite",
        ],
        conditions: {
          Bool: {
            "elasticfilesystem:AccessedViaMountTarget": "true",
          },
        },
      }),
    );

    // ========================================================================
    // CloudFormation Exports
    // ========================================================================

    // VPC exports
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: `VPC ID for ${accountName}`,
      exportName: `Hyperlane-${accountName}-VpcId`,
    });

    new cdk.CfnOutput(this, "VpcCidr", {
      value: this.vpc.vpcCidrBlock,
      description: `VPC CIDR block for ${accountName}`,
      exportName: `Hyperlane-${accountName}-VpcCidr`,
    });

    new cdk.CfnOutput(this, "VpcAvailabilityZones", {
      value: cdk.Fn.join(",", this.vpc.availabilityZones),
      description: `VPC availability zones for ${accountName}`,
      exportName: `Hyperlane-${accountName}-VpcAzs`,
    });

    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: cdk.Fn.join(
        ",",
        this.vpc.privateSubnets.map((s) => s.subnetId),
      ),
      description: `Private subnet IDs for ${accountName}`,
      exportName: `Hyperlane-${accountName}-PrivateSubnetIds`,
    });

    new cdk.CfnOutput(this, "PublicSubnetIds", {
      value: cdk.Fn.join(
        ",",
        this.vpc.publicSubnets.map((s) => s.subnetId),
      ),
      description: `Public subnet IDs for ${accountName}`,
      exportName: `Hyperlane-${accountName}-PublicSubnetIds`,
    });

    // Export EFS details
    new cdk.CfnOutput(this, "EfsId", {
      value: this.fileSystem.fileSystemId,
      description: `Shared EFS file system ID for ${accountName}`,
      exportName: `Hyperlane-${accountName}-EfsId`,
    });

    new cdk.CfnOutput(this, "EfsSecurityGroupId", {
      value: this.efsSecurityGroup.securityGroupId,
      description: `EFS security group ID for ${accountName}`,
      exportName: `Hyperlane-${accountName}-EfsSecurityGroupId`,
    });

    // ECS Cluster exports
    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: `ECS cluster name for ${accountName}`,
      exportName: `Hyperlane-${accountName}-ClusterName`,
    });

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.cluster.clusterArn,
      description: `ECS cluster ARN for ${accountName}`,
      exportName: `Hyperlane-${accountName}-ClusterArn`,
    });
  }
}
