import * as cdk from "aws-cdk-lib/core";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { HYPERLANE_ACCOUNTS } from "../configs/accounts";

export interface StorageStackProps extends cdk.StackProps {
  /**
   * Whether to deploy the ECR repository.
   * Generally this should be deployed to a single production account.
   *
   * Default: false
   **/
  deployEcr?: boolean;

  /**
   * List of AWS account IDs that are allowed to access the S3 bucket
   * This should be restricted to agents running on the same network (i.e devnet/testnet/mainnet)
   *
   * Used for cross-account access from customer accounts running agents
   * Example: ['123456789012', '098765432109']
   */
  s3TrustedAccountIds?: string[];
}

export class StorageStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    if (props.deployEcr) {
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
            (accountId) => new iam.AccountPrincipal(accountId),
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

    this.bucket = new s3.Bucket(this, "HyperlaneAgentsBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // these don't need to persist long-term
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const s3TrustedAccounts = props?.s3TrustedAccountIds ?? [];

    // Add cross-account access policy if trusted accounts are specified
    if (s3TrustedAccounts.length) {
      this.bucket.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: "AllowCrossAccountRead",
          effect: iam.Effect.ALLOW,
          principals: s3TrustedAccounts.map(
            (accountId) => new iam.AccountPrincipal(accountId),
          ),
          actions: [
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:ListBucket",
            "s3:GetBucketLocation",
          ],
          resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
        }),
      );

      this.bucket.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: "AllowCrossAccountWrite",
          effect: iam.Effect.ALLOW,
          principals: s3TrustedAccounts.map(
            (accountId) => new iam.AccountPrincipal(accountId),
          ),
          actions: [
            "s3:PutObject",
            "s3:PutObjectAcl",
            "s3:DeleteObject",
            "s3:AbortMultipartUpload",
          ],
          resources: [`${this.bucket.bucketArn}/*`],
        }),
      );
    }

    new cdk.CfnOutput(this, "BucketName", {
      value: this.bucket.bucketName,
      description: "S3 Bucket Name for validator signatures",
    });
    new cdk.CfnOutput(this, "BucketArn", {
      value: this.bucket.bucketArn,
      description: "S3 Bucket ARN for validator signatures",
    });
  }
}
