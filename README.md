### ECS Connect CLI

ecs-connect cli tool gives you ability to connect to ecs task container much more comfortably and interactively.

### ECS DB CONNECT GUID ###

export aws profile to terminal
```
export AWS_PROFILE=<profile-name>
```

obtain AWS token
```
aws sso login
```
use ecs-connect to print target-id use command next. u need to choose correct cluster/service/task/container
```
ecs-connect --print-only
```
export target to terminal
```
export TARGET=<printed-ecs-target>
```
[grab](https://www.notion.so/redberry/Session-Manager-Guide-Not-Complete-ad7f9979bf6140f4ba758d1ad2cd8701) database instance id from aws console. replace database-instance-id with it. adjust local port & execute
```
aws ssm start-session --target $TARGET --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{"host": ["database-instance-id"], "portNumber":["3306"],"localPortNumber":["3306"]}'
```
