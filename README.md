# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template

## Naming conventions

Ids for stacks generally follow the following conventions:

```
Hyperlane-${StackName}-${Network}-${AccountName}
```

Sometimes the `AccountName` isn't required, for example for ECR & signature stacks.

Following this convention allows us flexiblity to update stacks by purpose & network, for example:

- `Hyperlane-BaseInfra*` Deploy all base infrastructure stacks to all accounts
- `Hyperlane-BaseInfra-Testnet-*` Deploy all base infrastructure stacks to all testnet accounts
- `Hyperlane-BaseInfra-*-GTE*` Deploy base infrastructure stacks to all GTE customer accounts for all networks

Example:

```
npx cdk deploy "Hyperlane-BaseInfra-Testnet-*"
```

## Hyperlane agent ECR

TODO

## Signature Buckets

In Hyperlane, validators store their signatures in S3 buckets for relayers to validate.
Each network (testnet vs mainnet) has its own signature bucket. These buckets are deployed centrally in core accounts and permission is granted to all hyperlane related accounts to access them based on network.

To deploy the signature buckets, run the following command while authenticated as the deployment account:

```
npx cdk deploy "*SignatureStack*"
```

When a new hyperlane related account is created rerun deployment to update bucket permissions.

## Bootstrap new account

### Bootstrap CDK

Hyperlane infrastructure is multi-account due to the need to spread validator sets across accounts for security.
Because of this we bootstrap using a trusted deployment account that can deploy to multiple target accounts.

Firstly authenticate with our `Deployment Account` (650985922976) using your preferred method (e.g. AWS SSO, AWS CLI named profile, etc).

Then run the following command to bootstrap the target account/region, replacing `ACCOUNT_ID` and `REGION` as appropriate.

```
npx cdk bootstrap aws://ACCOUNT_ID/REGION --trust 650985922976 --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

### Bootstrap Hyperlane

Hyperlane has some base infrastructure that needs to be deployed into each account.

While authenticated as the deployment account, run the following command to deploy the Hyperlane base infrastructure into the target account/region, replacing `ACCOUNT_ID` and `REGION` as appropriate.

```
npx cdk deploy "*BaseInfra*"
```

This will perform deployments to all hyperlane related accounts, including our new account. Existing accounts will be unchanged.

## Wallet Management

Hyperlane uses AWS Secrets Manager to store private keys for our relayer wallets.

TODO: mention naming convention when saving wallet keys in secrets manager and key format
