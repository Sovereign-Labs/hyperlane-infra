import * as cdk from "aws-cdk-lib/core";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { HYPERLANE_ACCOUNTS } from "../configs/accounts";

export class EcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, "HyperlaneAgentsRepository", {
      repositoryName: "hyperlane-agents",
      imageScanOnPush: true,
      lifecycleRules: [
        {
          description: "Keep last 10 images",
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // All hyperlane accounts can pull images from this repository
    // Every hyperlane account has a agent running which requires image access
    this.repository.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCrossAccountPull",
        effect: iam.Effect.ALLOW,
        principals: HYPERLANE_ACCOUNTS.map(
          (account) => new iam.AccountPrincipal(account.id),
        ),
        actions: [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:DescribeImages",
          "ecr:GetRepositoryPolicy",
          "ecr:ListImages",
        ],
      }),
    );

    new cdk.CfnOutput(this, "RepositoryUri", {
      value: this.repository.repositoryUri,
      description: "ECR Repository URI for hyperlane agent",
    });
    new cdk.CfnOutput(this, "RepositoryArn", {
      value: this.repository.repositoryArn,
      description: "ECR Repository ARN for hyperlane agent",
    });
  }
}
