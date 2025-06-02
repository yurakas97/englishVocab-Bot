require('dotenv').config();
const TelegramApi = require('node-telegram-bot-api');
const path = require("path");
const fs = require('fs');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramApi(token, { polling: true });
const adminID = process.env.ADMIN_ID;
let chatId = adminID;
//let channelId = ""; chanel to be subscribed

let users = {};
let dbConnections = {};
const dbUsers = new sqlite3.Database('./dbUsers.sqlite'); //base to store users info
let botUsers = {};
let adminActionsMsg = [];
let adminMessages = [];
let usersToBeNotified = [];
let textToSend = "";

const buttons = {
    actionNextWord: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "⏭ Наступне", callback_data: "nextWord" }, { text: "☑️ Ні, зберегти урок", callback_data: "saveLesson" }],
                [{ text: "✒️ Редагувати", callback_data: "edit" }],
                [{ text: "🔊 Додати/замінити аудіо", callback_data: "addAudio" }],
                [{ text: "🔠 Додати приклади/підказки", callback_data: "addExamples" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    finishConfirm: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "  ГОТОВО!", callback_data: "done" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    deleteConfirm: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "  Так!", callback_data: "yesdelete" }, { text: "  НІ!", callback_data: "nodelete" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    showingReply: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "OK", callback_data: "ok" }, { text: "Видалити Урок", callback_data: "delete" }],
                [{ text: "Повторити Урок", callback_data: "repeat" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    chooseLenguage: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "🇺🇦 УКР", callback_data: "learnFromUkr" }, { text: "🇺🇸 ENG", callback_data: "learnFromEng" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    helpButton: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "Переклад", callback_data: "help" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    finishButton: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "Завершити", callback_data: "finish" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    deleteMessage: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "OK", callback_data: "deleteMessage" }],
            ]
        }),
        parse_mode: 'HTML'
    },
    confirmSend: {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: "Так", callback_data: "yesSend" }],
                [{ text: "Ні", callback_data: "deleteMessage" }],
            ]
        }),
        parse_mode: 'HTML'
    }
};

dbUsers.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    access INTEGER
  )
`);

// 2. Завантаження з бази при старті
function loadUsersFromDB() {
    dbUsers.all('SELECT * FROM users', [], (err, rows) => {
        if (err) return console.error(err);
        rows.forEach(row => {
            botUsers[row.id] = {
                username: row.username,
                first_name: row.first_name,
                last_name: row.last_name,
                access: !!row.access
            };
        });
        console.log('✅ Користувачі завантажені з бази.');
        console.log(botUsers);
    });
}
loadUsersFromDB();


bot.setMyCommands([
    { command: "/create", description: 'Створити урок' },
    { command: "/show", description: 'Показати всі уроки' },
    { command: "/stop", description: 'Зупинити' },
    { command: "/start", description: 'Запустити' }
]);

bot.sendMessage(chatId, "<b>Public bot started</b>\n------------------\n", { parse_mode: "HTML" });

bot.on("message", async msg => {
    //console.log(msg)
    let messageIdMain = msg.message_id;
    let user = msg.from.id;
    let text = msg.text;
    const { id, username, first_name, last_name } = msg.from;
    let thisUser = users[user];

    //let isSubscribed;
    let hasAccess;
    let userInfo = botUsers[id];
    if (userInfo) {
        hasAccess = userInfo.access;
    } else {
        hasAccess = false;
    }

    if (!hasAccess) {
        botUsers[id] = { username, first_name, last_name, access: false };
        dbUsers.run('INSERT OR IGNORE INTO users (id, username, first_name, last_name, access) VALUES (?, ?, ?, ?, ?)',
            [id, username, first_name, last_name, 0]);
        await bot.sendMessage(id, '🔒 Ви подали заявку на доступ. Очікуйте підтвердження.');

        const text = `🔔 Нова заявка:\n👤 ${first_name} (@${username})\nID: ${id}`;
        await bot.sendMessage(adminID, text, {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Прийняти', callback_data: `accept/${id}/${username}` },
                    { text: '❌ Відхилити', callback_data: `deny/${id}/${username}` }
                ]]
            }
        });
        return
    }


    // if (isSubscribed === undefined) {
    //     isSubscribed = await checkSubscription(user);
    // }
    // console.log(`${user} isSubscribed: ${isSubscribed}`);

    // if (!isSubscribed) {
    //     let alrert = (await bot.sendMessage(user, "Щоб користуватись ботом, підпишись на канал @english_with_music_series")).message_id;
    //     setTimeout(async function () {
    //         await bot.deleteMessage(user, alrert)
    //     }, 8000)
    //     return
    // }

    if (!users[user]) {

        users[user] = {
            messageId: null,
            lastActionTime: null,
            exist: true,
            id: user,
            messageIdReply: null,
            chosenLesson: {},
            mixedWords: null,
            lessonName: "",
            lessonCore: {},
            wordEng: null,
            wordUkr: null,
            promptId: null,
            promptId2: null,
            currentWord: null,
            questionId: null,
            questionId3: null,
            rightAnswerId: [],
            rightAnswerAudioId: [],
            rightAnswerExampleId: [],
            audioId: null,
            voiceFileId: null,
            example: null,
            exampleText: `\n`,
            lessonsArr: [],
            lessonNameMessage: null,
            startInputWords: null,
            engWordId: null,
            ukrWordId: null,
            lessonNameId: null,
            inputAgainId: null,
            audioMessageId: null,
            exampleMessageId: null,
            deleteMessageId: null,
            messageRepeadId: null,
            messagesToDelete: [],
            context: {
                lessonName: false,
                ENGwords: false,
                UKRwords: false,
                repead: false,
                editEng: false,
                editUkr: false,
                help: false,
                audioExpext: false,
                examplesExpect: false,
                delete: false,
            }
        };
        console.log(users[user])
        thisUser = users[user];
    }


    if (thisUser.exist) {
        //console.log(thisUser)

        let currentUserId = thisUser.id;
        console.log(`user entered: ${currentUserId}`);
        let chatId = user;
        thisUser.messageId = msg.message_id;
        thisUser.lastActionTime = Date.now();


        if (text === "/admin") {
            if (user != adminID) return

            let adminMessage = (await bot.sendMessage(adminID, "Доступні дії:", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Всі користувачі', callback_data: 'all_users' }],
                        [{ text: '✅ З доступом', callback_data: 'allowed' }],
                        [{ text: '❌ Без доступу', callback_data: 'denied' }],
                        [{ text: '📢 Розсилка', callback_data: 'broadcast' }],
                        [{ text: 'Видалити юзера', callback_data: 'deleteUser' }],
                        [{ text: 'Закрити', callback_data: 'closeAdmin' }]
                    ]
                }
            })).message_id;
            adminMessages.push(messageIdMain, adminMessage);
        }

        if (text === "/start") {
            thisUser.messagesToDelete.push(messageIdMain);
            await greeting(chatId);
        }

        await getUserDB(currentUserId);

        await getUserDB(currentUserId).serialize(() => {
            getUserDB(currentUserId).run(`
              CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                words TEXT NOT NULL
              )
            `);
        });

        if (text === "/stop") {
            thisUser.rightAnswerId.forEach((item) => {
                bot.deleteMessage(chatId, item)
            })

            thisUser.rightAnswerAudioId.forEach((item) => {
                bot.deleteMessage(chatId, item)
            })

            thisUser.rightAnswerExampleId.forEach((item) => {
                bot.deleteMessage(chatId, item)
            })

            if (thisUser.questionId) bot.deleteMessage(chatId, thisUser.questionId)
            if (thisUser.questionId3) bot.deleteMessage(chatId, thisUser.questionId3)

            thisUser.messageIdReply = null;
            thisUser.chosenLesson = {};
            thisUser.mixedWords = null;;
            thisUser.lessonName = "";
            thisUser.lessonCore = {};
            thisUser.wordEng = null;
            thisUser.wordUkr = null;;
            thisUser.promptId = null;
            thisUser.promptId2 = null;
            thisUser.currentWord = null;
            thisUser.questionId = null;
            thisUser.questionId3 = null;
            thisUser.rightAnswerId = [];
            thisUser.rightAnswerAudioId = [];
            thisUser.rightAnswerExampleId = [];
            thisUser.audioId = null;
            thisUser.voiceFileId = null;
            thisUser.example = null;
            thisUser.exampleText = `\n`;
            thisUser.lessonsArr = [];
            thisUser.messageId = null;
            thisUser.lastActionTime = null;
            thisUser.lessonNameMessage = null;
            thisUser.startInputWords = null;
            thisUser.engWordId = null;
            thisUser.ukrWordId = null;
            thisUser.inputAgainId = null;
            thisUser.lessonNameId = null;
            thisUser.audioMessageId = null;
            thisUser.exampleMessageId = null;
            thisUser.deleteMessageId = null;
            thisUser.messageRepeadId = null;
            thisUser.messagesToDelete = [];

            thisUser.context = {
                lessonName: false,
                ENGwords: false,
                UKRwords: false,
                repead: false,
                editEng: false,
                editUkr: false,
                help: false,
                audioExpext: false,
                examplesExpect: false,
                delete: false,
            }

            thisUser.messagesToDelete.push(messageIdMain);
            dbConnections[user] = null;
            console.log("stoped")
            return
        }

        if (thisUser.context.UKRwords) {
            thisUser.wordUkr = text;
            thisUser.context.UKRwords = false;
            thisUser.ukrWordId = msg.message_id;
            await new Promise(resolve => setTimeout(resolve, 1000));
            bot.deleteMessage(chatId, thisUser.startInputWords)
            bot.deleteMessage(chatId, thisUser.engWordId)
            bot.deleteMessage(chatId, thisUser.ukrWordId)
            thisUser.messageIdReply = (await bot.sendMessage(chatId, `<b>${thisUser.wordEng} - ${thisUser.wordUkr}</b>${thisUser.exampleText}\nНаступне слово?`, buttons.actionNextWord)).message_id;
            thisUser.messagesToDelete.push(thisUser.messageIdReply);
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (thisUser.context.ENGwords) {
            thisUser.engWordId = msg.message_id;
            thisUser.wordEng = text;
            thisUser.context.ENGwords = false;
            thisUser.context.UKRwords = true;
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (thisUser.context.lessonName) {
            thisUser.lessonNameId = msg.message_id;
            thisUser.lessonName = text;
            thisUser.context.lessonName = false;
            console.log(thisUser.lessonName)
            await new Promise(resolve => setTimeout(resolve, 1000));
            bot.deleteMessage(chatId, thisUser.lessonNameId)
            bot.deleteMessage(chatId, thisUser.lessonNameMessage)
            thisUser.startInputWords = (await bot.sendMessage(chatId, "Тепер додавай слова,\nСпочатку відправ АНГ слово,\nА потім окремо УКР")).message_id;
            thisUser.messagesToDelete.push(thisUser.startInputWords);
            thisUser.context.ENGwords = true;
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (text === "/create") {
            bot.deleteMessage(chatId, thisUser.messageId)
            thisUser.lessonNameMessage = (await bot.sendMessage(chatId, "Введи назву уроку")).message_id;
            thisUser.messagesToDelete.push(thisUser.lessonNameMessage);
            thisUser.context.lessonName = true;
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (text === "/show") {
            await bot.deleteMessage(chatId, msg.message_id)
            thisUser.messageIdReply = (await bot.sendMessage(chatId, await getLessons(currentUserId), buttons.showingReply)).message_id;
            thisUser.messagesToDelete.push(thisUser.messageIdReply);
            //console.log("list:", await getLessons())
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (thisUser.context.repead) {
            let lessonsToRepeat = text;
            thisUser.context.repead = false;
            bot.deleteMessage(chatId, thisUser.messageRepeadId)
            bot.deleteMessage(chatId, thisUser.messageIdReply)

            getLesson(thisUser.lessonsArr[lessonsToRepeat], currentUserId, (words) => {
                console.log("Words in lesson:", words);
                thisUser.chosenLesson = Object.entries(words);
            });
            console.log("chosen lesson: ", thisUser.chosenLesson)

            await bot.deleteMessage(chatId, msg.message_id)
            thisUser.messageIdReply = (await bot.sendMessage(chatId, `Якою мовою показувати слова?`, buttons.chooseLenguage)).message_id;
            thisUser.messagesToDelete.push(thisUser.messageIdReply);
            //mix

            thisUser.mixedWords = shuffleArray(thisUser.chosenLesson);
            console.log("mixed lesson", thisUser.mixedWords)
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (thisUser.context.delete) {
            let lessonsToDelete = text;
            let messageToDelete = msg.message_id;
            thisUser.context.delete = false;
            await bot.deleteMessage(chatId, thisUser.deleteMessageId)
            await bot.deleteMessage(chatId, thisUser.messageIdReply)
            //console.log(lessonsToRepeat)

            let sure = (await bot.sendMessage(chatId, `Я видаляю: <b>${thisUser.lessonsArr[lessonsToDelete]}</b>\nВірно?`, buttons.deleteConfirm)).message_id

            await new Promise((resolve) => {
                bot.once("callback_query", async (msg) => {
                    let data = msg.data;
                    //let messageId = msg.message_id;

                    if (data === "yesdelete") {
                        deleteLessonByName(thisUser.lessonsArr[lessonsToDelete], currentUserId)
                    }

                    resolve()
                })
            })
            thisUser.messagesToDelete.push(sure);
            await bot.deleteMessage(chatId, sure)

            //deleteLessonByName(lessonsArr[lessonsToDelete])
            console.log("chosen lesson to delete: ", lessonsToDelete)
            thisUser.messagesToDelete.push(messageIdMain);
            bot.deleteMessage(chatId, messageToDelete)

            return
        }

        if (thisUser.context.editEng) {
            thisUser.inputAgainId = msg.message_id;
            thisUser.context.editEng = false;
            await bot.deleteMessage(chatId, thisUser.messageIdReply)
            bot.deleteMessage(chatId, thisUser.inputAgainId)
            thisUser.wordEng = text;
            thisUser.messageIdReply = (await bot.sendMessage(chatId, `<b>${thisUser.wordEng} - ${thisUser.wordUkr}</b>${thisUser.exampleText}\nНаступне слово?`, buttons.actionNextWord)).message_id;
            thisUser.messagesToDelete.push(thisUser.messageIdReply);
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (thisUser.context.editUkr) {
            thisUser.inputAgainId = msg.message_id;
            thisUser.context.editUkr = false;
            await bot.deleteMessage(chatId, thisUser.messageIdReply)
            bot.deleteMessage(chatId, thisUser.inputAgainId)
            thisUser.wordUkr = text;
            thisUser.messageIdReply = (await bot.sendMessage(chatId, `<b>${thisUser.wordEng} - ${thisUser.wordUkr}</b>${thisUser.exampleText}\nНаступне слово?`, buttons.actionNextWord)).message_id;
            thisUser.messagesToDelete.push(thisUser.messageIdReply);
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (thisUser.context.audioExpext) {
            thisUser.context.audioExpext = false;
            thisUser.audioId = msg.message_id;
            //console.log(msg)
            thisUser.voiceFileId = msg.voice.file_id;
            await bot.deleteMessage(chatId, thisUser.audioMessageId)
            thisUser.messageIdReply = (await bot.sendMessage(chatId, `<b>${thisUser.wordEng} - ${thisUser.wordUkr}</b>${thisUser.exampleText}\nНаступне слово?`, buttons.actionNextWord)).message_id;
            thisUser.messagesToDelete.push(thisUser.messageIdReply);
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

        if (thisUser.context.examplesExpect) {
            thisUser.context.examplesExpect = false;
            thisUser.example = text;
            await bot.deleteMessage(chatId, thisUser.exampleMessageId)
            thisUser.exampleText += `${text}\n`;
            await bot.deleteMessage(chatId, msg.message_id);
            thisUser.messageIdReply = (await bot.sendMessage(chatId, `<b>${thisUser.wordEng} - ${thisUser.wordUkr}</b>${thisUser.exampleText}\nНаступне слово?`, buttons.actionNextWord)).message_id;
            thisUser.messagesToDelete.push(thisUser.messageIdReply);
            thisUser.messagesToDelete.push(messageIdMain);
            return
        }

    } else {
        console.log("message isn't allowed", msg)
    }

});

bot.on("callback_query", async msg => {
    let callbackUser = msg.from.id;
    let chatId = msg.from.id;
    let userName = msg.from.username;
    const action = msg.data;


    if (!users[callbackUser]) {

        users[callbackUser] = {
            messageId: null,
            lastActionTime: null,
            exist: true,
            id: callbackUser,
            messageIdReply: null,
            chosenLesson: {},
            mixedWords: null,
            lessonName: "",
            lessonCore: {},
            wordEng: null,
            wordUkr: null,
            promptId: null,
            promptId2: null,
            currentWord: null,
            questionId: null,
            questionId3: null,
            rightAnswerId: [],
            rightAnswerAudioId: [],
            rightAnswerExampleId: [],
            audioId: null,
            voiceFileId: null,
            example: null,
            exampleText: `\n`,
            lessonsArr: [],
            lessonNameMessage: null,
            startInputWords: null,
            engWordId: null,
            ukrWordId: null,
            inputAgainId: null,
            lessonNameId: null,
            audioMessageId: null,
            exampleMessageId: null,
            deleteMessageId: null,
            messageRepeadId: null,
            messagesToDelete: [],
            context: {
                lessonName: false,
                ENGwords: false,
                UKRwords: false,
                repead: false,
                editEng: false,
                editUkr: false,
                help: false,
                audioExpext: false,
                examplesExpect: false,
                delete: false,
            }
        };
        console.log(users[callbackUser])
    }

    users[callbackUser].lastActionTime = Date.now();

    if (msg.data === "deleteUser") {
        let shortMessage = (await bot.sendMessage(adminID, "ІД юзера якому скасувати доступ")).message_id;
        bot.once("message", async (msg) => {
            let userId = msg.text;
            bot.deleteMessage(adminID, msg.message_id);
            bot.deleteMessage(adminID, shortMessage);
            botUsers[userId].access = false;
            dbUsers.run('UPDATE users SET access = 0 WHERE id = ?', [userId]);
            let shortMessage2 = (await bot.sendMessage(adminID, `скасовано доступ для користувача ID:${userId}`)).message_id;
            setTimeout(() => {
                bot.deleteMessage(adminID, shortMessage2)
            }, 4000)
        })
    }

    if (action.startsWith('accept/')) {
        const userId = action.split('/')[1];
        const username = action.split('/')[2];
        if (botUsers[userId]) {
            botUsers[userId].access = true;
            dbUsers.run('UPDATE users SET access = 1 WHERE id = ?', [userId]);
            await bot.sendMessage(userId, '✅ Вам надано доступ. Вітаємо!');
            await bot.sendMessage(adminID, `🔗 Користувачу @${username} надано доступ.`);
            await greeting(userId);
        } else {
            await bot.sendMessage(adminID, '⚠️ Користувач не знайдений.');
        }
    }

    if (action.startsWith('deny/')) {
        const userId = action.split('/')[1];
        const username = action.split('/')[2];
        if (botUsers[userId]) {
            //delete botUsers[userId];
            //dbUsers.run('DELETE FROM users WHERE id = ?', [userId]);
            await bot.sendMessage(userId, '❌ Ваш запит на доступ було відхилено.');
            await bot.sendMessage(adminID, `🔗 Запит користувача @${username} відхилено.`);
        } else {
            await bot.sendMessage(adminID, '⚠️ Користувач не знайдений.');
        }
    }

    if (msg.data === "delete") {
        users[callbackUser].deleteMessageId = (await bot.sendMessage(chatId, "Який урок видалити? (Введи номер уроку)")).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].deleteMessageId);
        users[callbackUser].context.delete = true;
        return
    }

    if (msg.data === "saveLesson") {

        users[callbackUser].lessonCore[users[callbackUser].wordEng] = {};
        users[callbackUser].lessonCore[users[callbackUser].wordEng]["translate"] = users[callbackUser].wordUkr;

        if (users[callbackUser].example) {
            users[callbackUser].lessonCore[users[callbackUser].wordEng]["example"] = users[callbackUser].example;
        }

        if (users[callbackUser].voiceFileId) {
            await saveVoice(users[callbackUser].voiceFileId, callbackUser)
            users[callbackUser].lessonCore[users[callbackUser].wordEng]["audio"] = users[callbackUser].voiceFileId;
        }
        //lessonCore[wordEng] = wordUkr;
        saveLesson(users[callbackUser].lessonName, users[callbackUser].lessonCore, callbackUser);

        if (users[callbackUser].audioId) bot.deleteMessage(chatId, users[callbackUser].audioId);
        users[callbackUser].audioId = null;
        users[callbackUser].voiceFileId = null;
        users[callbackUser].example = null;
        users[callbackUser].exampleText = `\n`;

        bot.deleteMessage(chatId, users[callbackUser].messageIdReply)

        let lessonText = `<b>${users[callbackUser].lessonName}:</b>`;
        for (key in users[callbackUser].lessonCore) {
            lessonText += `\n${key} - ${users[callbackUser].lessonCore[key]["translate"]}`
        }

        users[callbackUser].messageIdReply = (await bot.sendMessage(chatId, lessonText, buttons.finishConfirm)).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].messageIdReply);
        fs.writeFileSync(`./users/${callbackUser}/txt/${users[callbackUser].lessonName}.txt`, lessonText, 'utf8');            // change to currentUser
        console.log('Файл записано!');
        console.log("saved leson: ", users[callbackUser].lessonCore)

        users[callbackUser].lessonCore = {};
        return
    }

    if (msg.data === "nextWord") {

        users[callbackUser].lessonCore[users[callbackUser].wordEng] = {};
        users[callbackUser].lessonCore[users[callbackUser].wordEng]["translate"] = users[callbackUser].wordUkr;

        if (users[callbackUser].example) {
            users[callbackUser].lessonCore[users[callbackUser].wordEng]["example"] = users[callbackUser].example;
        }

        if (users[callbackUser].voiceFileId) {
            await saveVoice(users[callbackUser].voiceFileId, callbackUser)
            users[callbackUser].lessonCore[users[callbackUser].wordEng]["audio"] = users[callbackUser].voiceFileId;
        }
        //lessonCore[wordEng] = wordUkr;

        bot.deleteMessage(chatId, users[callbackUser].messageIdReply);

        if (users[callbackUser].audioId) bot.deleteMessage(chatId, users[callbackUser].audioId);
        users[callbackUser].audioId = null;
        users[callbackUser].voiceFileId = null;
        users[callbackUser].example = null;
        users[callbackUser].exampleText = `\n`;

        users[callbackUser].startInputWords = (await bot.sendMessage(chatId, "Тепер додавай слова,\n спочатку відправ АНГ, а потім окремо УКР")).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].startInputWords);
        users[callbackUser].context.ENGwords = true;
        return
    }

    if (msg.data === "done") {
        await bot.deleteMessage(chatId, users[callbackUser].messageIdReply);
        await bot.sendDocument(chatId, `./users/${callbackUser}/txt/${users[callbackUser].lessonName}.txt`)

        users[callbackUser].messagesToDelete.forEach(async (item) => {
            try {
                await bot.deleteMessage(chatId, item)
                console.log("+");
            } catch (e) {
                console.log("*")
            }
        })

        return
    }

    if (msg.data === "ok") {
        bot.deleteMessage(chatId, users[callbackUser].messageIdReply);
        return
    }

    if (msg.data === "repeat") {
        users[callbackUser].messageRepeadId = (await bot.sendMessage(chatId, "Який урок повторити? (Введи номер уроку)")).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].messageRepeadId);
        users[callbackUser].context.repead = true;
        return
    }

    if (msg.data === "edit") {

        bot.deleteMessage(chatId, users[callbackUser].messageIdReply)

        let wordSelector = {
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{ text: `${users[callbackUser].wordEng}`, callback_data: "editEng" }, { text: `${users[callbackUser].wordUkr}`, callback_data: "editUkr" }],
                ]
            }),
            parse_mode: 'HTML'
        }

        users[callbackUser].messageIdReply = (await bot.sendMessage(chatId, "Яке зі слів", wordSelector)).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].messageIdReply);

        return
    }

    if (msg.data === "editEng") {
        await bot.deleteMessage(chatId, users[callbackUser].messageIdReply);
        users[callbackUser].messageIdReply = (await bot.sendMessage(chatId, "Введи заново")).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].messageIdReply);
        users[callbackUser].context.editEng = true;
        return
    }

    if (msg.data === "editUkr") {
        await bot.deleteMessage(chatId, users[callbackUser].messageIdReply);
        users[callbackUser].messageIdReply = (await bot.sendMessage(chatId, "Введи заново")).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].messageIdReply);
        users[callbackUser].context.editUkr = true;
        return
    }

    if (msg.data === "help") {
        users[callbackUser].promptId = (await bot.sendMessage(chatId, `💬 ${users[callbackUser].currentWord[0]} - ${users[callbackUser].currentWord[1]["translate"]}`)).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].promptId);
    }

    if (msg.data === "helpExample") {
        users[callbackUser].promptId2 = (await bot.sendMessage(chatId, `${users[callbackUser].currentWord[1]["example"]}`)).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].promptId2);
    }

    if ((msg.data === "learnFromUkr") || (msg.data === "learnFromEng")) {
        await bot.deleteMessage(chatId, users[callbackUser].messageIdReply);

        let indexQuestion;
        let indexAnswer;
        let audio;
        let example;

        if (msg.data === "learnFromUkr") {
            indexQuestion = 1;
            indexAnswer = 0;
        }

        if (msg.data === "learnFromEng") {
            indexQuestion = 0;
            indexAnswer = 1;
        }

        async function runQuiz() {

            for (let i = 0; i < users[callbackUser].mixedWords.length; i++) {
                if (users[callbackUser].promptId2) {
                    try {
                        await bot.deleteMessage(chatId, users[callbackUser].promptId2)
                    } catch (e) {
                        console.log("*")
                    }
                    users[callbackUser].promptId2 = null;
                }
                let question = users[callbackUser].mixedWords[i][indexQuestion];
                let answer = users[callbackUser].mixedWords[i][indexAnswer];

                if (msg.data === "learnFromEng") {
                    audio = answer.audio;
                    example = answer.example
                    answer = answer.translate;
                }

                if (msg.data === "learnFromUkr") {
                    audio = question.audio;
                    example = question.example;
                    question = question.translate;
                }

                //console.log("audio:", audio);

                if (users[callbackUser].context.help) {
                    if (example) {
                        buttons.helpButton = {
                            reply_markup: JSON.stringify({
                                inline_keyboard: [
                                    [{ text: "Переклад", callback_data: "help" }],
                                    [{ text: "Приклади/підказки", callback_data: "helpExample" }],
                                ]
                            }),
                            parse_mode: 'HTML'
                        };
                    } else {
                        buttons.helpButton = {
                            reply_markup: JSON.stringify({
                                inline_keyboard: [
                                    [{ text: "Переклад", callback_data: "help" }],
                                ]
                            }),
                            parse_mode: 'HTML'
                        };
                    }

                    users[callbackUser].questionId = (await bot.sendMessage(chatId, `- ${question} ❓`, buttons.helpButton)).message_id;
                    users[callbackUser].messagesToDelete.push(users[callbackUser].questionId);
                } else {
                    users[callbackUser].questionId3 = (await bot.sendMessage(chatId, `- ${question} ❓`)).message_id;
                    users[callbackUser].messagesToDelete.push(users[callbackUser].questionId3);
                }


                await new Promise((resolve) => {
                    bot.once("message", async (msg) => {

                        let text = msg.text;
                        let messageId = msg.message_id;
                        users[callbackUser].currentWord = users[callbackUser].mixedWords[i];

                        if (areStringsSimilar(text.toLowerCase(), answer.toLowerCase())) {

                            users[callbackUser].context.help = false;
                            let rightAnswer = (await bot.sendMessage(chatId, `🟢 Правильно: <b>${question} - ${answer}</b>`, { parse_mode: "HTML" })).message_id;
                            await new Promise(resolve => setTimeout(resolve, 100));
                            users[callbackUser].messagesToDelete.push(rightAnswer);
                            let rightAnswerAudio = [];
                            let rightAnswerExample = [];

                            if (example) {
                                rightAnswerExample = (await bot.sendMessage(chatId, example)).message_id;
                                users[callbackUser].rightAnswerExampleId.push(rightAnswerExample);
                                users[callbackUser].messagesToDelete.push(rightAnswerExample);
                            }

                            if (audio) {
                                rightAnswerAudio = (await bot.sendVoice(chatId, `./users/${callbackUser}/voice/${audio}.ogg`)).message_id;   //change to curentUser
                                users[callbackUser].rightAnswerAudioId.push(rightAnswerAudio);
                                users[callbackUser].messagesToDelete.push(rightAnswerAudio);
                            }

                            users[callbackUser].rightAnswerId.push(rightAnswer);
                            try {
                                await bot.deleteMessage(chatId, messageId)
                            } catch (e) {
                                console.log("*")
                            }

                            if (users[callbackUser].questionId) {

                                try {
                                    await bot.deleteMessage(chatId, users[callbackUser].questionId)
                                } catch (e) {
                                    console.log("*")
                                }
                                users[callbackUser].questionId = null;
                            }

                            if (users[callbackUser].questionId3) {
                                try {
                                    await bot.deleteMessage(chatId, users[callbackUser].questionId3)
                                } catch (e) {
                                    console.log("*")
                                }
                                users[callbackUser].questionId3 = null;
                            }

                            if (users[callbackUser].promptId) {
                                try {
                                    await bot.deleteMessage(chatId, users[callbackUser].promptId)
                                } catch (e) {
                                    console.log("*")
                                }
                                users[callbackUser].promptId = null;
                            }

                            let message1 = (await bot.sendMessage(chatId, "_________________________________")).message_id;
                            users[callbackUser].rightAnswerId.push(message1);
                            users[callbackUser].messagesToDelete.push(message1);

                            resolve(); // Переходимо до наступного слова
                        } else {

                            let message2 = (await bot.sendMessage(chatId, "🔴 Неправильно, спробуйте ще раз.")).message_id;
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            users[callbackUser].messagesToDelete.push(message2);
                            users[callbackUser].context.help = true;

                            users[callbackUser].questionId3
                                ? (async () => {
                                    try {
                                        await bot.deleteMessage(chatId, users[callbackUser].questionId3);
                                    } catch (e) {
                                        console.log("*")
                                    }
                                    users[callbackUser].questionId3 = null;
                                })()
                                : (async () => {
                                    try {
                                        await bot.deleteMessage(chatId, users[callbackUser].questionId);
                                    } catch (e) {
                                        console.log("*")
                                    }
                                    users[callbackUser].questionId = null;
                                })();


                            setTimeout(async function () {

                                try {
                                    await bot.deleteMessage(chatId, users[callbackUser].questionId3)
                                } catch (e) {
                                    console.log("*")
                                }
                                users[callbackUser].questionId3 = null;


                                try {
                                    await bot.deleteMessage(chatId, messageId)
                                } catch (e) {
                                    console.log("*")
                                }

                                try {
                                    await bot.deleteMessage(chatId, messageId + 1)
                                } catch (e) {
                                    console.log("*")
                                }

                            }, 2000)
                            i--; // Повторюємо це слово
                            resolve();
                        }
                    })
                })
            }
        }

        await runQuiz()
        let finishText = (await bot.sendMessage(chatId, "Вітаю! Ви пройшли всі слова.", buttons.finishButton)).message_id;
        users[callbackUser].messagesToDelete.push(finishText);
        users[callbackUser].rightAnswerId.push(finishText);
        return
    }

    if (msg.data === "finish") {
        users[callbackUser].rightAnswerId.forEach((item) => {
            bot.deleteMessage(chatId, item)
        })

        users[callbackUser].rightAnswerAudioId.forEach((item) => {
            bot.deleteMessage(chatId, item)
        })

        users[callbackUser].rightAnswerExampleId.forEach((item) => {
            bot.deleteMessage(chatId, item)
        })

        users[callbackUser].rightAnswerAudioId = [];
        users[callbackUser].rightAnswerId = [];
        users[callbackUser].rightAnswerExampleId = [];

        users[callbackUser].messagesToDelete.forEach(async (item) => {
            try {
                await bot.deleteMessage(chatId, item)
                console.log("+")
            } catch (e) {
                console.log("*")
            }
        })
        //dbConnections[callbackUser] = {};
        return
    }

    if (msg.data === "addAudio") {
        users[callbackUser].context.audioExpext = true;
        if (users[callbackUser].audioId) bot.deleteMessage(chatId, users[callbackUser].audioId);
        users[callbackUser].audioId = null;
        await bot.deleteMessage(chatId, users[callbackUser].messageIdReply)
        users[callbackUser].audioMessageId = (await bot.sendMessage(chatId, "Просто запиши і відправ голосове")).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].audioMessageId);

    }

    if (msg.data === "addExamples") {
        users[callbackUser].context.examplesExpect = true;
        await bot.deleteMessage(chatId, users[callbackUser].messageIdReply)
        users[callbackUser].exampleMessageId = (await bot.sendMessage(chatId, "Просто додай нотатки")).message_id;
        users[callbackUser].messagesToDelete.push(users[callbackUser].exampleMessageId);
    }

    if (msg.data === "all_users") {
        let text = '👥 Усі користувачі:\n';

        for (const [key, value] of Object.entries(botUsers)) {
            text += `🆔 ${key} | @${value.username || '---'} | ${value.access ? '✅' : '❌'}\n`;
        }
        let message = (await bot.sendMessage(adminID, text || 'Немає користувачів.', buttons.deleteMessage)).message_id;
        adminActionsMsg.push(message);
        return
    }

    if (msg.data === "allowed") {
        let text = '👥 Активні користувачі:\n';

        for (const [key, value] of Object.entries(botUsers)) {
            if (value.access) {
                text += `🆔 ${key} | @${value.username || '---'} | ✅\n`;
            }
        }
        let message = (await bot.sendMessage(adminID, text || 'Немає користувачів.', buttons.deleteMessage)).message_id;
        adminActionsMsg.push(message);
        return
    }

    if (msg.data === "denied") {
        let text = '👥 Не активні користувачі:\n';

        for (const [key, value] of Object.entries(botUsers)) {
            if (!value.access) {
                text += `🆔 ${key} | @${value.username || '---'} | ❌\n`;
            }
        }
        let message = (await bot.sendMessage(adminID, text || 'Немає користувачів.', buttons.deleteMessage)).message_id;
        adminActionsMsg.push(message);
        return
    }

    if (msg.data === "yesSend") {

        usersToBeNotified.forEach(user => {
            bot.sendMessage(user, textToSend)
        })

        adminActionsMsg.forEach(msgId => {
            try {
                bot.deleteMessage(adminID, msgId);
            } catch (e) {
                console.log(e)
            }
        })
        adminActionsMsg = [];
        usersToBeNotified = [];
        return
    }

    if (msg.data === "broadcast") {
        let message = (await bot.sendMessage(adminID, "Кому?", {
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{ text: "З доступом", callback_data: "sendToWithAccess" }],
                    [{ text: "Без доступа", callback_data: "sendToWithoutAccess" }],
                    [{ text: "Всім", callback_data: "sendToAll" }],
                    [{ text: "Скасувати", callback_data: "deleteMessage" }],
                ]
            }),
            parse_mode: 'HTML'
        })).message_id;
        adminActionsMsg.push(message);
        return
    }

    if (msg.data === "sendToWithAccess") {
        let shortMessage = (await bot.sendMessage(adminID, "Текст повідомлення")).message_id;

        await new Promise((resolve) => {
            bot.once("message", async (msg) => {
                bot.deleteMessage(adminID, shortMessage)
                textToSend = msg.text;
                bot.deleteMessage(adminID, msg.message_id)

                let message = (await bot.sendMessage(adminID, `Відправити цей текст усім активним користувачам?\n - ${textToSend}`, buttons.confirmSend)).message_id;
                adminActionsMsg.push(message)

                for (const [key, value] of Object.entries(botUsers)) {
                    if (value.access) {
                        usersToBeNotified.push(key)
                    }
                }

                resolve()
            })
        })
        return
    }

    if (msg.data === "sendToWithoutAccess") {
        let shortMessage = (await bot.sendMessage(adminID, "Текст повідомлення")).message_id;

        await new Promise((resolve) => {
            bot.once("message", async (msg) => {
                bot.deleteMessage(adminID, shortMessage)
                textToSend = msg.text;
                bot.deleteMessage(adminID, msg.message_id)

                let message = (await bot.sendMessage(adminID, `Відправити цей текст усім неактивним користувачам?\n - ${textToSend}`, buttons.confirmSend)).message_id;
                adminActionsMsg.push(message)

                for (const [key, value] of Object.entries(botUsers)) {
                    if (!value.access) {
                        usersToBeNotified.push(key)
                    }
                }
                resolve()
            })
        })
        return
    }

    if (msg.data === "sendToAll") {
        let shortMessage = (await bot.sendMessage(adminID, "Текст повідомлення")).message_id;

        await new Promise((resolve) => {
            bot.once("message", async (msg) => {
                bot.deleteMessage(adminID, shortMessage)
                textToSend = msg.text;
                bot.deleteMessage(adminID, msg.message_id)

                let message = (await bot.sendMessage(adminID, `Відправити цей текст усім користувачам?\n - ${textToSend}`, buttons.confirmSend)).message_id;
                adminActionsMsg.push(message)

                for (const [key, value] of Object.entries(botUsers)) {
                    usersToBeNotified.push(key)
                }

                resolve()
            })
        })
        return
    }

    if (msg.data === "deleteMessage") {
        adminActionsMsg.forEach(msgId => {
            try {
                bot.deleteMessage(adminID, msgId);
            } catch (e) {
                console.log(e)
            }
        })
        adminActionsMsg = [];
        usersToBeNotified = [];
        return
    }

    if (msg.data === "closeAdmin") {
        adminMessages.forEach(msgId => {
            try {
                bot.deleteMessage(adminID, msgId);
            } catch (e) {
                console.log(e)
            }
        })
        adminMessages = [];
        return
    }


});


async function greeting(chatId) {
    await bot.sendMessage(chatId, "Привіт.\nТут ти можеш створювати уроки та зберігати а потім повторювати англійські слова і вирази\n\nНижче коротка відеоінструкція як користуватись ботом");

    const videoPath = path.resolve(__dirname, "instruction.mp4"); // Отримуємо абсолютний шлях

    // try {
    //     await bot.sendVideo(chatId, fs.createReadStream(videoPath), {
    //         width: 1280, // Ширина (16:9)
    //         height: 720, // Висота (16:9)
    //         supports_streaming: true, // Відео не програватиметься автоматично
    //     });
    // } catch (error) {
    //     console.error("Помилка при відправці відео:", error);
    // }

    await bot.sendMessage(chatId, "----------------\nЩоб створити перший урок зі словами обери 'Створити урок' в меню бота і слійдуй інструкціям\n----------------")
    return
}

function getUserDB(user) {

    const userDir = `./users/${users[user].id}`;

    // Перевіряємо, чи існує папка для користувача
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true }); // Створюємо папку, якщо вона не існує
        fs.mkdirSync(`${userDir}/voice`, { recursive: true });
        fs.mkdirSync(`${userDir}/txt`, { recursive: true });
    }

    if (!dbConnections[user]) {
        const userDir = path.join(__dirname, 'users', `${user}`);

        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        dbConnections[user] = new sqlite3.Database(`./users/${users[user].id}/vocab_bot.db`);
        dbConnections[user].run("PRAGMA journal_mode = WAL;"); // Уникаємо блокувань
    }
    return dbConnections[user];
}

function saveLesson(name, wordsObject, callbackUser) {
    const wordsJSON = JSON.stringify(wordsObject);
    const query = `INSERT INTO lessons (name, words) VALUES (?, ?)`;
    getUserDB(callbackUser).run(query, [name, wordsJSON], function (err) {
        if (err) {
            return console.error(err.message);
        }
        console.log(`Lesson "${name}" saved with ID: ${this.lastID}`);
    });
}

function getLesson(name, currentUser, callback) {
    const query = `SELECT words FROM lessons WHERE name = ?`;
    getUserDB(currentUser).get(query, [name], (err, row) => {
        if (err) {
            return console.error(err.message);
        }
        if (row) {
            const wordsObject = JSON.parse(row.words);
            callback(wordsObject);
        } else {
            console.log("Lesson not found");
        }
    });
}

function getLessons(currentUser) {
    return new Promise((resolve, reject) => {
        let lessonsList = "";

        getUserDB(currentUser).all("SELECT name FROM lessons", [], (err, rows) => {
            if (err) {
                console.error("Error retrieving lessons:", err.message);
                reject(err); // Відхиляє Promise у випадку помилки
                return;
            }
            users[currentUser].lessonsArr = [0];
            let counter = 1;
            console.log(`Кількість уроків: ${rows.length}`);
            rows.forEach((row) => {
                lessonsList += `\n🔗  ${counter++}_${row.name}`; // Додаємо кожен урок до рядка
                users[currentUser].lessonsArr.push(row.name);
            });

            lessonsList = lessonsList || "Ще немає уроків";

            resolve(lessonsList); // Повертає результат після завершення запиту
        });
    });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        // Генеруємо випадковий індекс j, де 0 ≤ j ≤ i
        const j = Math.floor(Math.random() * (i + 1));

        // Міняємо місцями елементи за індексами i і j
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function saveVoice(fileId, callbackUser) {
    //const voiceFileId = msg.voice.file_id;

    bot.getFile(fileId).then((file) => {
        const filePath = file.file_path; // Отримуємо шлях до файлу
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${filePath}`;

        // Завантажуємо файл
        const fileName = `./users/${callbackUser}/voice/${fileId}.ogg`; // Назва файлу
        const fileStream = fs.createWriteStream(fileName);

        https.get(fileUrl, (response) => {
            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                console.log("Audio recorded on server")
            });
        }).on('error', (err) => {
            fs.unlink(fileName); // У разі помилки видаляємо частково завантажений файл
            console.error("Error downloading the file:", err);
        });
    }).catch((err) => {
        console.error("Error getting file info:", err);
    });

}

function deleteLessonByName(name, currentUser) {
    const query = `DELETE FROM lessons WHERE name = ?`;
    getUserDB(currentUser).run(query, [name], function (err) {
        if (err) {
            return console.error("Error deleting lesson:", err.message);
        }
        if (this.changes > 0) {
            console.log(`Lesson "${name}" deleted successfully.`);
        } else {
            console.log(`Lesson "${name}" not found.`);
        }
    });
}

function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;

    // Ініціалізація матриці
    const dp = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

    // Заповнюємо базові випадки
    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    // Розраховуємо відстань Левенштейна
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1]; // Немає змін
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,   // Видалення
                    dp[i][j - 1] + 1,   // Вставка
                    dp[i - 1][j - 1] + 1 // Заміна
                );
            }
        }
    }

    return dp[len1][len2];
}

function areStringsSimilar(str1, str2) {
    let one = str1.replace(/\s+/g, '');
    let two = str2.replace(/\s+/g, '');
    const maxErrors = Math.floor(Math.max(one.length, two.length) * 0.12)
    const distance = levenshteinDistance(one, two);
    //console.log(distance)
    return distance <= maxErrors;
}

async function checkSubscription(userId) {
    try {
        const chatMember = await bot.getChatMember(channelId, userId);
        return ["member", "administrator", "creator"].includes(chatMember.status);
    } catch (error) {
        console.error("Помилка перевірки підписки:", error);
        return false;
    }
}

function lastActionTimer() {
    setInterval(function () {
        let currentTime = Date.now();
        for (let key in users) {
            let userActionTime = users[key].lastActionTime;
            let difference = currentTime - userActionTime;

            if (difference > 36000000) {

                delete users[key];
                dbConnections[key] = null;
                console.log(`stoped user: ${key} session due to timeout`)
            }
        }
    }, 40000000)
};

lastActionTimer()