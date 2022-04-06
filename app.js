const mineflayer = require('mineflayer')
const { categories } = require('./data.json')
require('dotenv').config(); // read the env

/**
 * REMEMBER TO FINISH BUILDING BLOCKS CATEGORY
 */

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
/** @type {ChestNode[]} */
var chestNodes = [];

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
        this.full = false
        this.lastAccessed = 0
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
    chestNodes = [];//empty the list first
    //don't forget to catch specialty chests too, e.g. "Gold" would override the classifier and cause the bot to prioritize putting gold in there if it can
    bot.findBlocks({
        matching: block => block.displayName == "Chest" ? true : false, count: 10
    }).forEach(block => {//searches for chests
        let signText = testAround(block.x, block.y, block.z)
        if (signText) {
            var text = signText.trim().toLowerCase()
            var entry = categories.find(category =>
                category.aliases.includes(text)
            )
            if (entry) {
                chestNodes.push(new ChestNode(entry.name, block.x, block.y, block.z))
                bot.chat(`Registered ${block} as ${entry.name}`)
                console.log(`Registered ${block} as ${entry.name}`)
            } else {
                bot.chat(`Unknown category: "${text}"`)
                console.log(`Unknown category: ${text}`)
            }
        }
    })
    if (chestNodes.length > 0) {
        let o = chestNodes[0].Vec3
        bot.pathfinder.setGoal(new GoalNear(o.x, o.y, o.z, 2))
    } else {
        console.log("No chests found!")
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
        if (chestNodes.length == 0) return;
        activityInterval = setInterval(() => {
            // Do not start another tick if a window is already open
            if (bot.currentWindow) return;
            let currentNode = chestNodes[0]
            let chest = bot.blockAt(currentNode.Vec3)
            let botItems = bot.inventory.items()
            let freeBotSlots = 0;
            let freeChestSlots = 0;
            for (let i = 9; i < 44; i++) {
                // I know those are weird numbers, but it's just how the inventory API works
                // Trust me....
                if (bot.inventory.slots[i] == null) freeBotSlots++;
            }
            chestNodes.push(chestNodes.shift())

            // Use bot.canDigBlock to verify range of chest
            if (bot.canDigBlock(chest)) {
                console.log(`Opening ${chest}`)
                bot.openChest(chest).then((c) => {
                    currentNode.lastAccessed = Date.now()
                    // Normal chest range: 0-26
                    // Double chest range: 0-53
                    // First identify the chest type using the window title
                    let largeChest;
                    let chestSlots = [];
                    if (bot.currentWindow.title == '{"translate":"container.chest"}') { largeChest = false; }
                    else if (bot.currentWindow.title == '{"translate":"container.chestDouble"}') { largeChest = true; }
                    else {
                        console.log(`Unknown chest type: ${bot.currentWindow.title}`)
                        return;
                    }
                    // Update chestSlots while counting free slots
                    if (largeChest) {
                        for (let i = 0; i < 53; i++) {
                            if (bot.currentWindow.slots[i] == null) freeChestSlots++;
                            chestSlots.push(bot.currentWindow.slots[i])
                        }
                    } else {
                        for (let i = 0; i < 26; i++) {
                            if (bot.currentWindow.slots[i] == null) freeChestSlots++;
                            chestSlots.push(bot.currentWindow.slots[i])
                        }
                    }
                    const extractItems = () => {
                        return new Promise((resolve) => {
                            let withdrawQueue = [];
                            setTimeout(() => {
                                console.log("Withdrawing took too long, aborting")
                                resolve()
                            }, 5000);
                            for (let i = 0; i < chestSlots.length; i++) {
                                let item = chestSlots[i]
                                if (item) {
                                    if (!currentNode.allowedItems.includes(item.name) && freeBotSlots >= 1) {
                                        withdrawQueue.push(item)
                                    }
                                }
                            }
                            if (withdrawQueue.length >= 1) {
                                // Start withdrawing
                                let withdraw = (item) => {
                                    console.log(`Withdrawing ${item.name} x${item.count}`)
                                    c.withdraw(item.type, item.metadata, item.count).then(() => {
                                        freeBotSlots--;
                                        if (withdrawQueue.length >= 1) {
                                            withdraw(withdrawQueue.shift())
                                        } else {
                                            console.log("Withdrawing finished")
                                            resolve()
                                        }
                                    })
                                }
                                withdraw(withdrawQueue.shift())
                            }
                        })
                    }
                    const insertItems = () => {
                        return new Promise((resolve) => {
                            let depositQueue = [];
                            setTimeout(() => {
                                console.log("Depositing took too long, aborting")
                                resolve()
                            }, 5000);
                            for (let i = 0; i < botItems.length; i++) {
                                let item = botItems[i]
                                if (item) {
                                    if (currentNode.allowedItems.includes(item.name) && freeChestSlots >= 1) {
                                        depositQueue.push(item)
                                    }
                                }
                            }
                            if (depositQueue.length >= 1) {
                                // Start depositing
                                let deposit = (item) => {
                                    console.log(`Depositing ${item.name} x${item.count}`)
                                    c.deposit(item.type, item.metadata, item.count).then(() => {
                                        freeChestSlots--;
                                        if (depositQueue.length >= 1) {
                                            deposit(depositQueue.shift())
                                        } else {
                                            console.log("Depositing finished")
                                            resolve()
                                        }
                                    })
                                }
                                deposit(depositQueue.shift())
                            }
                        })
                    }
                    Promise.all([
                        insertItems(), extractItems()
                    ]).then(() => c.close())
                })
            }
        }, 1000)
    }

    bot.on('chat', (username, message) => {
        console.log(`> ${username}: ${message}`)
        if (!process.env.CONTROL_ACCOUNTS.includes(username)) return;
        if (!message.startsWith(".")) return;
        let command = message.substring(1).split(" ")[0].toLowerCase()

        switch (command) {
            case "sort":
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

            case "sleep":
                if (activityInterval) clearInterval(activityInterval)
                let bed = bot.findBlock({ matching: block => block.displayName == "Bed", count: 1 })
                if (bed) {
                    bot.pathfinder.setGoal(new GoalNear(bed.x, bed.y, bed.z, 2))

                    /**
                     * UNFINISHED
                     */


                } else {
                    console.log("No bed found!")
                }
                break;
        }
    })
})