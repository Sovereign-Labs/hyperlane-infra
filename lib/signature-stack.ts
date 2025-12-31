import * as cdk from "aws-cdk-lib/core";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface SignatureStackProps extends cdk.StackProps {
  /**
   * List of AWS account IDs that are allowed to access the S3 bucket
   * This should be restricted to agents running on the same network (i.e devnet/testnet/mainnet)
   *
   * Used for cross-account access from customer accounts running agents
   * Example: ['123456789012', '098765432109']
   */
  trustedAccountIds?: string[];

  network: string;
}

export class SignatureStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SignatureStackProps) {
    super(scope, id, props);

    const { network, trustedAccountIds } = props;

    this.bucket = new s3.Bucket(this, "HyperlaneAgentsBucket", {
      bucketName: `hyperlane-signatures-${network}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // these don't need to persist long-term
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const s3TrustedAccounts = trustedAccountIds ?? [];

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
