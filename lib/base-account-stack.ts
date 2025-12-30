import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface BaseAccountStackProps extends cdk.StackProps {
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
 */
export class BaseAccountStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly fileSystem: efs.FileSystem;
  public readonly efsSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: BaseAccountStackProps) {
    super(scope, id, props);

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
      vpcName: "hyperlane-vpc",
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

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: this.vpc,
      clusterName: "hyperlane-cluster",
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // Create security group for EFS
    this.efsSecurityGroup = new ec2.SecurityGroup(this, "EfsSecurityGroup", {
      vpc: this.vpc,
      description: "Security group for EFS file system",
      allowAllOutbound: false,
    });

    this.fileSystem = new efs.FileSystem(this, "FileSystem", {
      vpc: this.vpc,
      securityGroup: this.efsSecurityGroup,
      fileSystemName: "hyperlane-efs",
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

    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "VPC ID",
    });

    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: "ECS cluster name",
    });

    new cdk.CfnOutput(this, "EfsId", {
      value: this.fileSystem.fileSystemId,
      description: "EFS file system ID",
    });
  }
}
