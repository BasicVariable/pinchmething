import fs from "node:fs";
import yaml from "js-yaml";
import chalk from "chalk";

import "./subFiles/utilities.js";
import {Browser, pinchMeRequests} from "./subFiles/pinchMe.js";

const delayedClose = async (page) => {
    setTimeout(async () => {
        if (page.isClosed()) return;
        await page.close();
    }, 60_000)
}

const cycleSurveys = async (controls, surveys) => {
    const {browser, pinchMe} = controls;

    for (let survey of surveys.availableCampaigns) {
        let
            surveyPath = `https://pinchme.com/apply/${survey.campaignId}/${survey.promoId}/${survey.productVariantDetails[0].productVariantId}/${survey.productId}`,
            newPage = await browser.browser.newPage(),
            questions = browser.interceptRequest(newPage, "https://pinchme.com/_a/promo-surveys", {}, 20_000)
        ;
        await newPage.goto(surveyPath, { waitUntil: 'networkidle2',timeout: 0 })
            .catch(() => {});

        if (await newPage.url() !== surveyPath || !questions) {
            console.log(`Failed to load survey ${chalk.cyan(survey.promoTitle ?? "N/A")} (33), ${chalk.red("retrying later!!")}`);
            delayedClose(newPage);
            continue
        }
        try {
            questions = await (await questions).json();
        }catch (e) {
            console.log(`Failed to load survey ${chalk.cyan(survey.promoTitle ?? "N/A")}`, e);
            delayedClose(newPage);
            continue
        }

        let answers = await pinchMe.getAnswers(questions.surveys, survey.campaignId);
        if  (!answers) {
            console.log(`Failed to get answers for ${chalk.cyan(survey.promoTitle ?? "N/A")} (22), ${chalk.red("retrying later!!")}`);
            delayedClose(newPage);
            continue
        }

        let result = await pinchMe.submitAnswers(newPage, answers,{
            items: [{
                promoId: survey.promoId,
                productVariantId: survey.productVariantDetails[0].productVariantId
            }]
        });
        try {
            if (!result.includes("success")) {
                console.log(`Failed to submit survey ${chalk.cyan(survey.promoTitle ?? "N/A")} (55), ${chalk.red("retrying later!!")}`);
                delayedClose(newPage);
            }else{
                console.log(`${chalk.green("Successfully submitted survey")} ${chalk.cyan(survey.promoTitle ?? "N/A")}`);
            }
        }catch (e) {
            console.log(`Failed to submit survey ${chalk.cyan(survey.promoTitle ?? "N/A")}`, e);
            delayedClose(newPage);
        }
    }
}

fs.readFile("../config.yml", 'utf-8', async (err, res) => {
    if (err) {
        console.log("Failed to read config.yml", err);
        await reactiveDelay(20_000, process.exit)
    }

    let config;
    try{
        config = yaml.load(res)
    }catch(err){
        console.log("Failed to parse yaml", err);
        await reactiveDelay(20_000, process.exit)
    }

    const browser = new Browser(config.browserWebsocket);
    await browser.init();
    if (!browser.page) {
        console.log("Failed to attach to the browser", err);
        await reactiveDelay(20_000, process.exit)
    }

    const pinchMe = new pinchMeRequests(browser);
    while (true) {
        let surveys = await pinchMe.getSurveys();
        if (!surveys) {
            log("Failed to get surveys", "error");
            await reactiveDelay(10_000); continue
        }

        await cycleSurveys({browser, pinchMe}, surveys);
        await reactiveDelay(30_000);
    }
})