#! /usr/bin/env node

import chalk from 'chalk';
import inquirer from 'inquirer';
import {
    ECSClient,
    ListTasksCommand,
    ListClustersCommand,
    ListServicesCommand,
    DescribeTasksCommand,
    DescribeServicesCommand,
    DescribeClustersCommand,
} from '@aws-sdk/client-ecs';
import {spawn, execSync} from 'child_process';
import {createSpinner} from 'nanospinner';
import {
    DescribeDBInstancesCommand,
    RDSClient
} from "@aws-sdk/client-rds";

const data = {
    cluster: {
        name: null,
        arn: null,
    },
    service: {
        name: null,
        arn: null,
    },
    taskArn: null,
    containers: null,
    containerRuntimeId: null,
    connectionType: null,
    dbInstance: {
        instance: null,
        endpoint: null,
        port: null,
    },
};

const ecsClient = new ECSClient();

const getHelp = () => {
    console.log(chalk.bold('Simplified way to connect ECS containers'))
    console.log(`
Usage: ecs-connect [OPTIONS]

Options:

-h, --help              Information about the usage of the tool and its options
--print-only            print target to the console to use it for any purpose(for example: port forwarding)
    `);
}

const runningWithoutInstall = () => {
    return !data.dependencies?.['ecs-connect'];
}

const getCurrentVersion = () => {
    const rawData = execSync('npm list -g --json').toString().trim();
    const data = JSON.parse(rawData);
    const {version} = data.dependencies['ecs-connect'];
    return version;
}

const getLatestVersion = () => {
    return execSync('npm view ecs-connect version').toString().trim();
}

const isUpToDate = () => {
    return getCurrentVersion() === getLatestVersion();
}

const checkVersion = () => {

    if (runningWithoutInstall()) {
        console.log(chalk.yellowBright.italic("Version check is not available. You are probably running package with npx.\n"))
        return;
    }

    if (!isUpToDate()) {
        console.log('Your version is behind! - ' + chalk.redBright.italic(getCurrentVersion()))
        console.log(
            'Please update the package to get the latest version! ' +
            chalk.yellow.italic(getLatestVersion()),
        );
        console.log('Run ' + chalk.yellowBright.italic('npm -g update ecs-connect'));
        console.log("\n\n");
    }
}

const welcome = () => {
    console.log(
        chalk.bold.blueBright('ECS Connect 🔌'),
    );
    console.log('');
}

const askAboutCluster = async () => {
    const {clusterArns} = await ecsClient.send(new ListClustersCommand({}));
    const {clusters} = await ecsClient.send(
        new DescribeClustersCommand({clusters: clusterArns}),
    );

    const answer = await inquirer.prompt([{
        type: 'list',
        name: 'cluster',
        message: 'Choose your cluster',
        choices: [...clusters.map(el => el.clusterName), {type: 'separator'}, 'Cancel'],
    }]);

    if (answer.cluster === 'Cancel')
        process.exit(0);

    data.cluster.name = answer.cluster;
    data.cluster.arn = clusters.find(el => el.clusterName === answer.cluster).clusterArn;
}

const getServiceList = async (cluster) => {
    let serviceList = [];
    let nextToken = undefined;

    while (nextToken !== null) {
        const { nextToken: newNextToken, serviceArns } = await ecsClient.send(
            new ListServicesCommand({ cluster, nextToken })
        );

        nextToken = newNextToken ?? null;

        if (serviceArns?.length) {
            const { services } = await ecsClient.send(
                new DescribeServicesCommand({ services: serviceArns, cluster })
            );
            serviceList.push(...services);
        }
    }

    return serviceList;
}

const askAboutServices = async () => {
    const services = await getServiceList(data.cluster.arn)
    const {service} = await inquirer.prompt([{
        type: 'list',
        name: 'service',
        message: 'Choose service inside a cluster',
        choices: [...services.map(el => el.serviceName), {type: 'separator'}, 'Go Back'],
    }]);

    if (service !== 'Go Back') {
        data.service.name = service;
        data.service.arn = services.find(el => el.serviceName === service).serviceArn;
    }

    return service;
}

const askAboutTasks = async () => {
    const {taskArns} = await ecsClient.send(new ListTasksCommand({
        cluster: data.cluster.arn,
        serviceName: data.service.name,
        desiredStatus: 'RUNNING'
    }));
    const {tasks} = await ecsClient.send(new DescribeTasksCommand({cluster: data.cluster.arn, tasks: taskArns}));
    const taskTrimmedArns = tasks.map(el => {
        const chunks = el.taskArn.split(data.cluster.name + '/');
        return chunks[chunks.length - 1];
    });

    const {task} = await inquirer.prompt([{
        type: 'list',
        name: 'task',
        message: 'Choose task inside service',
        choices: [...taskTrimmedArns, {type: 'separator'}, 'Go Back'],
    }]);

    if (task !== 'Go Back') {
        data.taskArn = task;
        data.containers = tasks.find(el => el.taskArn.endsWith(task)).containers;
    }

    return task;
}

const askAboutContainers = async () => {
    const {container} = await inquirer.prompt([{
        type: 'list',
        name: 'container',
        message: 'Choose container to connect',
        choices: [...data.containers.map(el => el.name), {type: 'separator'}, 'Go Back'],
    }]);

    if (container !== 'Go Back') {
        data.containerRuntimeId = data.containers.find(el => el.name === container).runtimeId;
    }

    return container;
}

const getTarget = () => {
    return `ecs:${data.cluster.name}_${data.taskArn}_${data.containerRuntimeId}`;
}

const connectToContainer = () => {
    const command_args = [
        'ssm',
        'start-session',
        '--document-name=AWS-StartInteractiveCommand',
        '--parameters=command=su -l',
        '--target=' + getTarget()
    ]

    console.log("\n");

    let child = null;
    process.on('SIGINT', (signal) => {
        if (child != null) {
            child.kill('SIGINT');
        }
    });

    const spinner = createSpinner('Wait for connection...');
    spinner.start();
    setTimeout(() => {
        spinner.stop();
        child = spawn('aws', command_args, {stdio: 'inherit'});
    }, 1000);
}

const askAboutDBInstances = async () => {
    const client = new RDSClient();
    const {DBInstances} = await client.send(new DescribeDBInstancesCommand());

    const dbInstances = [];
    const clusterName = data.cluster.name.split('-').slice(0, -1).join('-');

    DBInstances.forEach((instance) => {
        if (instance.DBInstanceIdentifier.includes(clusterName))
            dbInstances.push({
                instance: instance.DBInstanceIdentifier,
                endpoint: instance.Endpoint.Address,
                port: instance.Endpoint.Port,
            })
    });

    const {instance} = await inquirer.prompt([{
        type: 'list',
        name: 'instance',
        message: 'Choose container to connect',
        choices: [...dbInstances.map(el => el.instance), {type: 'separator'}, 'Cancel'],
    }]);

    if (instance === 'Cancel')
        process.exit(0);

    data.dbInstance = dbInstances.find(el => el.instance === instance);

    return instance;
}

const connectToDatabase = async () => {

    await askAboutDBInstances();


    const command_args = [
        'ssm',
        'start-session',
        '--target=' + getTarget(),
        '--document-name=AWS-StartPortForwardingSessionToRemoteHost',
        '--parameters={"host": ["' + data.dbInstance.endpoint + '"], "portNumber":["' + data.dbInstance.port + '"],"localPortNumber":["33066"]}',
    ];

    console.log("\n");

    const spinner = createSpinner('Wait for connection...');
    spinner.start();
    setTimeout(() => {
        spinner.stop();
        spawn('aws', command_args, {stdio: 'inherit'});
    }, 1000);
}

const shouldHelp = () => {
    const args = process.argv.slice(2);
    return args.length > 0 && ['-h', '--help'].includes(args[0]);
}

const askAboutConnection = async () => {

    const {connection} = await inquirer.prompt([{
        type: 'list',
        name: 'connection',
        message: 'Choose what to connect',
        choices: ['DB', 'Shell', {type: 'separator'}, 'Go Back'],
    }]);

    if (connection !== 'Go Back') {
        data.connectionType = connection;
    }

    return connection;
}

const connect = async () => {
    switch (data.connectionType) {
        case 'DB':
            connectToDatabase();
            break;
        case 'Shell':
            connectToContainer();
            break;
    }
}

(async () => {
    try {
        const args = process.argv.slice(2);

        !shouldHelp() && checkVersion();

        welcome();

        if (shouldHelp()) {
            getHelp();
            process.exit(0);
        }

        const bus = [
            askAboutCluster,
            askAboutServices,
            askAboutTasks,
            askAboutContainers,
            askAboutConnection,
        ];

        for (let i = 0; i < bus.length; i++) {
            const result = await bus[i]();

            if (result == 'Go Back') {
                i -= 2;
            }
        }

        if (args.length > 0 && args[0] === '--print-only') {
            console.log('');
            console.log(chalk.blueBright.italic(getTarget()));
        } else {
            await connect();
        }

    } catch (e) {
        console.log(chalk.redBright.bold(e.message));
    }
})();