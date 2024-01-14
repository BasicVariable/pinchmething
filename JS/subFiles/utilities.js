import chalk from "chalk";

global.log = (msg, type) => {
    const time = chalk.bgMagenta.black(`[${new Date().toLocaleTimeString()}]`);
    if (typeof msg == "object" && type != "error") msg = JSON.stringify(msg, null, '\t');
    msg = chalk.black(msg);

    switch (type) {
        case "error":
            console.log(`${time} ${chalk.bgRedBright(`[ERROR] ${msg}`)}`);
            break;
        case "warn":
            console.log(`${time} ${chalk.bgYellow(`[WARN] ${msg}`)}`);
            break;
        case "info":
            console.log(`${time} ${chalk.bgCyan(`[INFO] ${msg}`)}`);
            break;
        default:
            if (global?.boyDebug === true) console.log(`[${time}] ${chalk.bgBlueBright(`[DEBUG] ${msg}`)}`);
    }
    // return msg
};

global.fetchTimeout = (url, ms, { signal, ...options } = {}) => {
    const controller = new AbortController();
    const promise = fetch(url, { signal: controller.signal, ...options });
    const timeout = setTimeout(() => controller.abort(), ms);
    return promise.finally(() => clearTimeout(timeout));
};

global.reactiveDelay = (ms, reaction) => new Promise(async res => {
    setTimeout(async () => {
        if (typeof reaction == "function") res(await reaction());
        res()
    }, ms)
});

global.random = (min, max) => Math.floor(Math.random() * (max - min)) + min;