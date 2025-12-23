import * as cdk from "aws-cdk-lib/core";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface StorageStackProps extends cdk.StackProps {
  /**
   * Account name for consistent export naming
   * Example: "sovereign-testnet", "sovereign-mainnet"
   */
  accountName: string;

  /**
   * List of AWS account IDs that are allowed to access the S3 bucket & ECR repository
   * Used for cross-account access from customer accounts running agents
   * Example: ['123456789012', '098765432109']
   */
  trustedAccountIds?: string[];
}

export class StorageStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StorageStackProps) {
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

    const trustedAccounts = props?.trustedAccountIds ?? [];

    // Add cross-account access policy for ECR if trusted accounts are specified
    if (trustedAccounts.length) {
      this.repository.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: "AllowCrossAccountPull",
          effect: iam.Effect.ALLOW,
          principals: trustedAccounts.map(
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
    }

    this.bucket = new s3.Bucket(this, "HyperlaneAgentsBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Add cross-account access policy if trusted accounts are specified
    if (trustedAccounts.length) {
      this.bucket.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: "AllowCrossAccountRead",
          effect: iam.Effect.ALLOW,
          principals: trustedAccounts.map(
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
          principals: trustedAccounts.map(
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

    const accountName = props?.accountName || "default";

    new cdk.CfnOutput(this, "RepositoryUri", {
      value: this.repository.repositoryUri,
      description: `ECR Repository URI for ${accountName}`,
      exportName: `Hyperlane-${accountName}-RepositoryUri`,
    });
    new cdk.CfnOutput(this, "RepositoryArn", {
      value: this.repository.repositoryArn,
      description: `ECR Repository ARN for ${accountName}`,
      exportName: `Hyperlane-${accountName}-RepositoryArn`,
    });
    new cdk.CfnOutput(this, "BucketName", {
      value: this.bucket.bucketName,
      description: `S3 Bucket Name for ${accountName}`,
      exportName: `Hyperlane-${accountName}-BucketName`,
    });
    new cdk.CfnOutput(this, "BucketArn", {
      value: this.bucket.bucketArn,
      description: `S3 Bucket ARN for ${accountName}`,
      exportName: `Hyperlane-${accountName}-BucketArn`,
    });
  }
}
