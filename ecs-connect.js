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
import { spawn, execSync } from 'child_process';
import { createSpinner } from 'nanospinner';

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
};

const client = new ECSClient();

const getHelp = () => {
    console.log(chalk.bold('Simplified way to connect ECS containers'))
    console.log(`
Usage: ecs-connect [OPTIONS]

Options:

-h, --help              Information about the usage of the tool and its options
--print-only            print target to the console to use it for any purpose(for example: port forwarding)
    `);
}

const getCurrentVersion = () => {
    const rawData = execSync('npm list -g --json').toString().trim();
    const data = JSON.parse(rawData);
    const { version } = data.dependencies['ecs-connect'];
    return version;
}

const getLatestVersion = () => {
    return execSync('npm view ecs-connect version').toString().trim();
}

const isUpToDate = () => {
    return getCurrentVersion() === getLatestVersion();
}

const checkVersion = () => {
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
    const { clusterArns } = await client.send(new ListClustersCommand({}));
    const { clusters } = await client.send(
        new DescribeClustersCommand({ clusters: clusterArns }),
    );

    const answer = await inquirer.prompt([{
        type: 'list',
        name: 'cluster',
        message: 'Choose your cluster',
        choices: [...clusters.map(el => el.clusterName), { type: 'separator' }, 'Cancel'],
    }]);

    if (answer.cluster === 'Cancel')
        process.exit(0);

    data.cluster.name = answer.cluster;
    data.cluster.arn = clusters.find(el => el.clusterName === answer.cluster).clusterArn;
}

const askAboutServices = async () => {
    const { serviceArns } = await client.send(new ListServicesCommand({ cluster: data.cluster.arn }));
    const { services } = await client.send(new DescribeServicesCommand({ services: serviceArns, cluster: data.cluster.arn }));

    const { service } = await inquirer.prompt([{
        type: 'list',
        name: 'service',
        message: 'Choose service inside a cluster',
        choices: [...services.map(el => el.serviceName), { type: 'separator' }, 'Go Back'],
    }]);

    if (service !== 'Go Back') {
        data.service.name = service;
        data.service.arn = services.find(el => el.serviceName === service).serviceArn;
    }

    return service;
}

const askAboutTasks = async () => {
    const { taskArns } = await client.send(new ListTasksCommand({ cluster: data.cluster.arn, serviceName: data.service.name, desiredStatus: 'RUNNING' }));
    const { tasks } = await client.send(new DescribeTasksCommand({ cluster: data.cluster.arn, tasks: taskArns }));
    const taskTrimmedArns = tasks.map(el => {
        const chunks = el.taskArn.split(data.cluster.name + '/');
        return chunks[chunks.length - 1];
    });

    const { task } = await inquirer.prompt([{
        type: 'list',
        name: 'task',
        message: 'Choose task inside service',
        choices: [...taskTrimmedArns, { type: 'separator' }, 'Go Back'],
    }]);

    if (task !== 'Go Back') {
        data.taskArn = task;
        data.containers = tasks.find(el => el.taskArn.endsWith(task)).containers;
    }

    return task;
}

const askAboutContainers = async () => {
    const { container } = await inquirer.prompt([{
        type: 'list',
        name: 'container',
        message: 'Choose container to connect',
        choices: [...data.containers.map(el => el.name), { type: 'separator' }, 'Go Back'],
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
    const command = `aws ssm start-session --target ${getTarget()}`;
    console.log("\n");

    const spinner = createSpinner('Wait for connection...');
    spinner.start();
    setTimeout(() => {
        spinner.stop();
        spawn(command, { stdio: 'inherit', shell: 'sh' });
    }, 3000);
}

const shouldHelp = () => {
    const args = process.argv.slice(2);
    return args.length > 0 && ['-h', '--help'].includes(args[0]);
}

(async function () {
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
        }
        else {
            connectToContainer();
        }

    } catch (e) {
        console.log(chalk.redBright.bold(e.message));
    }
})();