import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface NetworkStackProps extends cdk.StackProps {
  /**
   * Number of Availability Zones to use
   * Default: 2
   */
  maxAzs?: number;

  /**
   * Number of NAT Gateways (for cost optimization)
   * 1 = single NAT gateway (cheaper, less resilient)
   * 2 = NAT gateway per AZ (more resilient, more expensive)
   * Default: 1
   */
  natGateways?: number;

  /**
   * Enable VPC endpoints for ECR and S3
   * This reduces data transfer costs but adds endpoint costs
   * Recommended for production
   * Default: false
   */
  enableVpcEndpoints?: boolean;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: NetworkStackProps) {
    super(scope, id, props);

    // Create VPC
    this.vpc = new ec2.Vpc(this, "HyperlaneVPC", {
      maxAzs: props?.maxAzs || 2,
      natGateways: props?.natGateways || 1,
      subnetConfiguration: [
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
      ],
    });

    // Add VPC endpoints if enabled (cost optimization)
    if (props?.enableVpcEndpoints) {
      // S3 Gateway Endpoint (free, no data transfer charges for S3 access from VPC)
      this.vpc.addGatewayEndpoint("S3Endpoint", {
        service: ec2.GatewayVpcEndpointAwsService.S3,
      });

      // ECR API Endpoint (for pulling images)
      this.vpc.addInterfaceEndpoint("EcrApiEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.ECR,
      });

      // ECR Docker Endpoint (for pulling image layers)
      this.vpc.addInterfaceEndpoint("EcrDockerEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      });

      // CloudWatch Logs Endpoint (for ECS logs)
      this.vpc.addInterfaceEndpoint("CloudWatchLogsEndpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      });
    }

    // Outputs
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "VPC ID",
      exportName: "HyperlaneVpcId",
    });

    new cdk.CfnOutput(this, "VpcCidr", {
      value: this.vpc.vpcCidrBlock,
      description: "VPC CIDR Block",
    });

    new cdk.CfnOutput(this, "PrivateSubnets", {
      value: this.vpc.privateSubnets.map((s) => s.subnetId).join(","),
      description: "Private Subnet IDs",
    });

    new cdk.CfnOutput(this, "PublicSubnets", {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(","),
      description: "Public Subnet IDs",
    });
  }
}
