const mineflayer = require('mineflayer')
const { categories } = require('./data.json')
require('dotenv').config(); // read the env

//check config
if (!process.env.CONTROL_ACCOUNTS || process.env.CONTROL_ACCOUNTS.length == 0) throw new Error("Owner not specified!")
var bot = mineflayer.createBot({
    host: process.env.TARGET_HOST ? process.env.TARGET_HOST : "localhost",
    port: process.env.TARGET_PORT ? process.env.TARGET_PORT : 25565,
    username: process.env.BOT_USERNAME ? process.env.BOT_USERNAME : "sorter_bot",
    // password: process.env.PASSWORD, // please for the love of god don't use this
    version: false     // auto-detect version
})

const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { GoalNear, GoalBlock, GoalXZ, GoalY, GoalInvert, GoalFollow } = require('mineflayer-pathfinder').goals;
const { Vec3 } = require('vec3');
const { Item } = require('prismarine-item');

bot.loadPlugin(pathfinder)
const inventoryViewer = require('mineflayer-web-inventory')
let invViewerOps = {
    port: 8080
}

let activityInterval = null;

class ChestNode {
    /**
     * @param {"potions"|"brewing"|"weapons"|"food"|"farming"|"transport"|"tools"|"armor"|"glass"|"wool"|"redstone"|"concrete"|"banner"|"building_blocks"|"ore"|"dye"|"clay"|"materials"|"music"|"misc"} 
     *type Required: The category of the chest
     */
    constructor(type, x, y, z) {
        this.type = type
        // Just leave blank if not found
        let f = categories.find(cat => cat.name == type)
        this.allowedItems = f ? f.items : []
        this.x = x
        this.y = y
        this.z = z
        // Generate now, so we don't have to do it later
        this.Vec3 = new Vec3(x, y, z)
    }
}

// Functions


/**
 * Scans and returns any chests it finds, or null if it can't find any
 * @returns {ChestNode[]|null} The results of the search. Can be null
 */
function setupChests() {
    allDestinations = [];//empty the list first
    //don't forget to catch specialty chests too, e.g. "Gold" would override the classifier and cause the bot to prioritize putting gold in there if it can
    bot.findBlocks({
        matching: block => block.displayName == "Chest" ? true : false, count: 10
    }).forEach(block => {//searches for chests
        let signText = testAround(block.x, block.y, block.z)
        if (signText) {
            var text = signText.trim().toLowerCase()
            var entry = config.categories.find(category =>
                category.aliases.includes(text)
            )
            if (entry) {
                allDestinations.push(new ChestNode(entry.name, block.x, block.y, block.z))
                bot.chat(`Registered ${block} as ${entry.name}`)
                console.log(`Registered ${block} as ${entry.name}`)
            } else {
                bot.chat(`Unknown category: "${text}"`)
                console.log(`Unknown category: ${text}`)
            }
        }
    })
    if (allDestinations.length > 0) {
        let o = allDestinations[0].Vec3
        bot.pathfinder.setGoal(new GoalNear(o.x, o.y, o.z, 2))
    } else {
        bot.chat("There aren't any chests with signs on them nearby!")
        bot.chat("Please lead me to your chest room before using this command.")
    }
}

/**
 * Searches for a sign around the block, and returns the text if found
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {string|null}
 */
function testAround(x, y, z) {
    let testPos = new Vec3(x, y, z)
    testPos.x++;
    if (bot.blockAt(testPos).name.includes("sign")) {//pos x
        return bot.blockAt(testPos).signText
    }
    testPos.x -= 2;
    if (bot.blockAt(testPos).name.includes("sign")) {//negative x
        return bot.blockAt(testPos).signText
    }
    testPos.x++;//reset x
    testPos.z++;
    if (bot.blockAt(testPos).name.includes("sign")) {//pos z
        return bot.blockAt(testPos).signText
    }
    testPos.z -= 2;
    if (bot.blockAt(testPos).name.includes("sign")) {//negative z
        return bot.blockAt(testPos).signText
    }
    return null;
}


// Events

bot.on('kicked', (reason) => console.log("Kicked: " + reason))
bot.on('login', () => console.log("Logged in"))
bot.on('death', () => console.log("I died..."))
bot.on('error', err => console.log(err))

bot.once('spawn', () => {
    // Save to access data and start inv viewer after spawning
    const mcData = require('minecraft-data')(bot.version)
    const defaultMove = new Movements(bot, mcData)
    inventoryViewer(bot, invViewerOps)

    // Restrict movement because it's designed for safe, controlled environments
    defaultMove.canDig = false;
    defaultMove.allow1by1towers = false;
    defaultMove.allowParkour = false;
    defaultMove.allowFreeMotion = false;

    const startSorting = () => {
        setupChests();
        activityInterval = setInterval(() => {

        }, 1000)
    }

    bot.on('chat', (username, message) => {
        console.log(`${username}: ${message}`)
        if (!process.env.CONTROL_ACCOUNTS.includes(username)) return;
        if (!message.startsWith(".")) return;
        let command = message.substring(1).split(" ")[0].toLowerCase()

        switch (command) {
            case "start":
                startSorting()
                break;

            case "stop":
                bot.pathfinder.setGoal(null)
                if (activityInterval) {
                    clearInterval(activityInterval)
                    activityInterval = null
                }
                break;

            case "come":
            case "here":
            case "follow":
                activityInterval = setInterval(() => {
                    let target = bot.players[username].entity
                    if (!target) return;
                    bot.pathfinder.setGoal(new GoalNear(target.position.x, target.position.y, target.position.z, 2))
                }, 250)
                break;
        }
    })
})