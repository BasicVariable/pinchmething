import puppeteer from "puppeteer";
import UserAgent from "user-agents";
import { createCursor } from "ghost-cursor";
// import { distance, closest } from "fastest-levenshtein";

class Browser {
    constructor(browserSocket) {
        this.browser = null;
        this.chromeWs = browserSocket;
        this.page = null;
        this.USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    async interceptRequest(page, rUrl, data, timeout) {
        return await new Promise(async (res) => {
            const
                timeoutTimer = setTimeout(() => {
                    res(null);
                }, timeout),
                hasData = Object.keys(data ?? {}).length > 0
            ;

            if (hasData) {
                await page.setRequestInterception(true);
                page.on('request', async (request) => {
                    if (request.url() === rUrl) {
                        request.continue();
                        return;
                    }

                    clearTimeout(timeoutTimer);
                    try {
                        if (hasData) {
                            if (hasData?.block) request.abort();

                            let requestBody = request.postData() || request.body();
                            data.body = Object.assign(
                                requestBody ?? {},
                                data.body
                            );

                            if (data.postData) {
                                let
                                    requestPostData = request.postData() || request.body(),
                                    fixedPostData = new URLSearchParams(requestPostData)
                                ;

                                for (let [key, value] of Object.entries(data.postData)) {
                                    fixedPostData.set(key, value);
                                }
                                data.postData = fixedPostData.toString();
                            }

                            data.headers = Object.assign(
                                request.headers(), data?.headers ?? {}
                            );
                            request.continue(data);
                            await page.setRequestInterception(false);
                        }
                    }catch (e) {
                        console.log(e)
                    }
                });
            }

            page.on('response', async (response) => {
                if (response.url() !== rUrl) return;

                if (!hasData) clearTimeout(timeoutTimer);
                res(response);
            })
        })
    }

    async injectFetch (page, url, options) {
        return await page.evaluate(async (url, options) => {
            try {
                options.headers = Object.assign({
                    "accept": "application/json, text/plain, */*",
                    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "TE": "trailers"
                }, options?.headers ?? {});
                let request = await fetch(url, options);
                return await request.text();
            }catch (e) {
                return `fail, ${e}`
            }
        }, url, options)
    }

    async createPage(options) {

        //Randomize User agent or Set a valid one
        const UA = (new UserAgent({ deviceCategory: 'desktop' })) ?? this.USER_AGENT
        const page = await this.browser.newPage();

        //Randomize viewport size
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            hasTouch: false,
            isLandscape: false,
            isMobile: false,
        });

        page.cursor = createCursor(page);
        await page.setUserAgent(UA.toString());

        if (options?.proxy != null) {
            // According to stack overflow posts there aren't any official ways of assigning a specific proxy to a page, you'll need to intercept the requests and push them through the proxy w/ someone's package
        }

        return page;
    }

    async init() {
        const checkBrowserStatus = async () => {
            try{
                if (!this.browser) {
                    if (this.chromeWs <= 0) return false;

                    this.browser = await puppeteer.connect({
                        ignoreHTTPSErrors: true,
                        browserWSEndpoint: this.chromeWs,
                        dumpio: true,
                        args: [
                            '--disable-web-security',
                            '--disable-features=IsolateOrigins',
                            '--disable-site-isolation-trials'
                        ],
                        protocolTimeout: 500_000,
                        targetFilter: (target) => !!target.url
                    }).catch((err) => console.log(err));
                    this.page = await this.createPage({original: true});

                    return true;
                }

                if ((await this.browser.pages()).length > 0) return true;
            }catch (e) {
                log(`Failed to start headless browser\n${e}`, "error");
            }
        }

        new Promise(async () => {
            while (true) {
                let started = await checkBrowserStatus();
                if (!started) {
                    log("Browser connection closed", "error");
                    await reactiveDelay(20_000, process.exit)
                }

                await reactiveDelay(20_000);
            }
        })

        let started = await checkBrowserStatus();
        if (started) return true;
    }
}

class pinchMeRequests {
    constructor(browser) {
        this.browser = browser;
    }

    async getSurveys() {
        let
            page = this.browser.page,
            intercept = this.browser.interceptRequest(page, "https://pinchme.com/_a/get-available-user-campaigns", {}, 30_000)
        ;
        await page.goto("https://pinchme.com/dashboard", { waitUntil: 'networkidle2',timeout: 0 })
            .catch(() => {});

        if (page.url() !== "https://pinchme.com/dashboard") {
            log("Failed to load pinchme dashboard, please login to the site first", "error");
            return;
        }

        try {
            // await hell
            return await (await intercept).json();
        }catch (e) {
            console.log(e)
        }
    }

    // Could not and would not figure out how to get their csrf token so I just stole it from an outgoing request <3
    async submitAnswers(page, answers, promosClaimObject) {
        return new Promise(async (res) => {
            let
                xTokens = [],
                initTime = Date.now()
            ;
            await page.setRequestInterception(true)
            page.on('request', async (request) => {
                if (xTokens.length > 1) return;

                try{
                    let authToken = request.headers()["x-auth-token"];
                    if (
                        !(request.url()).includes("https://pinchme.com/_a") ||
                        !authToken
                    ) {
                        request.continue(); return;
                    }

                    xTokens.push(authToken);
                    await request.abort()
                }catch (e) {}
            });
            await page.reload().catch(() => {});

            while (xTokens.length < 2) {
                if (Date.now() - initTime > 30_000) {
                    res("fail");
                    return;
                }
                await reactiveDelay(1_000);
            }
            await page.setRequestInterception(false);

            await this.browser.injectFetch(page, "https://pinchme.com/_a/submit-survey", {
                method: "POST",
                headers: {
                    "X-Auth-Token": xTokens[0],
                    "Referer": await page.url(),
                    "Origin": "https://pinchme.com"
                },
                body: JSON.stringify(answers)
            });

            res(
                await this.browser.injectFetch(page, "https://pinchme.com/_a/claim-promos", {
                    method: "POST",
                    headers: {
                        "Referer": await page.url(),
                        "X-Auth-Token": xTokens[1],
                        "Origin": "https://pinchme.com"
                    },
                    body: JSON.stringify(promosClaimObject)
                })
            )

            await page.close();
        })
    }

    async getAnswers(questions, campaignId) {
        const getAnswer = (qContent, options) => {
            for (let [key, value] of Object.entries(options)) {
                let randomOption = value[random(0, value.length - 1)];
                if (value.length === 1) randomOption = value[0];
                if (!randomOption && key === "boolean") {
                    randomOption = {name: (random(0, 1) === 0 ? true : false)};
                    value = [{}];
                }

                switch (key) {
                    case "boolean": case "oneOf":
                        let needsAYes = [
                            "please answer each question thoughtfully. Do you agree to commit to this",
                            "do you agree to provide feedback"
                        ].some((word) => qContent.includes(word));

                        if (needsAYes){
                            for (let option of value) {
                                if (
                                    [
                                        "yes",
                                        "true"
                                    ].some(condition =>
                                        ((option?.name ?? "yes").toLowerCase()).includes(condition)
                                    )
                                ) return option?.name ?? true;
                            }
                        }
                        return randomOption?.name;
                    case "anyOf":
                        let selectAll = [
                            "products",
                            "supplies"
                        ].some((word) => qContent.includes(word));

                        if (selectAll) {
                            return value.reduce((acc, option) => {
                                if ((option.name.toLowerCase()).includes("none")) return acc;
                                acc.push(option.name);
                                return acc
                            }, [])
                        }
                        return randomOption.name;

                }
            }
        }

        /*
        PLEASE KONNOR do it this way or you'll have to reformat it when u post it to the api
        {
            surveyAnswers: [
                {
                    campaignId: "",
                    questionId:"", // get this from the promo surveys request
                    body:{"question name": "answer name"} // unless it's a boolean fieldtype, do true/false
                }
            ]
        }
         */
        return {
            surveyAnswers: questions.reduce((acc, question) => {
                let
                    subQuestions = question.questions
                ;

                for (let subQuestion of subQuestions) {
                    let answer = getAnswer(
                        subQuestion.value.contents,
                        subQuestion.value.fieldType
                    );
                    if (!answer) continue;

                    acc.push({
                        campaignId,
                        questionId: subQuestion.id,
                        body: {
                            [subQuestion.value.name]: answer
                        }
                    })
                }
                return acc
            }, [])
        }
    }
}

export { Browser, pinchMeRequests }