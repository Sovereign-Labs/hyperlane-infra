import * as cdk from "aws-cdk-lib/core";
import * as iam from "aws-cdk-lib/aws-iam";
//import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

// TODO:
// publish to ECR/ECS from github actions using OIDC
export interface CICDStackProps extends cdk.StackProps {
  /**
   * GitHub organization and repository that can assume the role.
   * Format: "org/repo" or ["org/repo1", "org/repo2"]
   * Example: "myorg/hyperlane-agents" or ["myorg/repo1", "myorg/repo2"]
   */
  githubRepos: string | string[];

  /**
   * ECR repository ARN to grant push permissions to.
   */
  ecrRepositoryArn: string;
}

export class CICDStack extends cdk.Stack {
  public readonly githubActionsRole: iam.Role;

  constructor(scope: Construct, id: string, props: CICDStackProps) {
    super(scope, id, props);

    const repos = Array.isArray(props.githubRepos)
      ? props.githubRepos
      : [props.githubRepos];

    // Create OIDC provider for GitHub Actions
    // GitHub's OIDC provider is the same for all accounts
    const githubProvider = new iam.OpenIdConnectProvider(
      this,
      "GitHubOIDCProvider",
      {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
        thumbprints: [
          "6938fd4d98bab03faadb97b34396831e3780aea1", // GitHub's thumbprint
          "1c58a3a8518e8759bf075b76b750d4f2df264fcd", // Backup thumbprint
        ],
      },
    );

    // Create condition for trust policy - allow specific GitHub repos
    const conditions: { [key: string]: any } = {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      },
    };

    // Allow multiple repos to assume this role
    if (repos.length === 1) {
      conditions.StringLike = {
        "token.actions.githubusercontent.com:sub": `repo:${repos[0]}:*`,
      };
    } else {
      conditions.StringLike = {
        "token.actions.githubusercontent.com:sub": repos.map(
          (repo) => `repo:${repo}:*`,
        ),
      };
    }

    // Create IAM role for GitHub Actions
    this.githubActionsRole = new iam.Role(this, "GitHubActionsRole", {
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.openIdConnectProviderArn,
        conditions,
        "sts:AssumeRoleWithWebIdentity",
      ),
      description: "Role assumed by GitHub Actions for CI/CD",
      roleName: "GitHubActionsRole",
      maxSessionDuration: cdk.Duration.hours(1),
    });

    this.githubActionsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:ListImages",
        ],
        resources: [props.ecrRepositoryArn],
      }),
    );

    // GetAuthorizationToken is account-level, must use "*"
    this.githubActionsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );

    // Output the role ARN for use in GitHub Actions
    new cdk.CfnOutput(this, "GitHubActionsRoleArn", {
      value: this.githubActionsRole.roleArn,
      description: "ARN of the IAM role for GitHub Actions to assume",
      exportName: "GitHubActionsRoleArn",
    });

    // Output the OIDC provider ARN
    new cdk.CfnOutput(this, "GitHubOIDCProviderArn", {
      value: githubProvider.openIdConnectProviderArn,
      description: "ARN of the GitHub OIDC provider",
    });
  }
}
