import child from 'child_process';
import readline from 'readline';
require('dotenv').config(); // read the env

let app = child.spawn('ts-node', ['./bot.ts'], { shell: true });
let cleanExit = false;

app.on('error', console.error);
app.on('message', console.log);
app.on('exit', (code) => {
    if (!cleanExit) {
        console.log(`Bot exited with code ${code}`);
        process.exit(1);
    }
});

let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const prompt = () => {
    rl.question('> ', (cmd) => {
        if (cmd === 'exit') {
            cleanExit = true;
            console.log('Exiting...');
            app.kill();
            process.exit(0);
        } else {
            app.send(cmd);
            prompt();
        }
        rl.close();
    });
};
setTimeout(() => {
    // Wait for everything to start up
    prompt();
}, 3000);