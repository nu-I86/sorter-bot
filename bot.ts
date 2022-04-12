const mineflayer = require('mineflayer')
const { categories } = require('./data.json')
require('dotenv').config(); // read the env

var controlAccounts: String[] | null = process.env.CONTROL_ACCOUNTS ? JSON.parse(process.env.CONTROL_ACCOUNTS) as Array<string> : null;
if (!controlAccounts || controlAccounts.length == 0) { throw new Error('CONTROL_ACCOUNTS is not defined') }

//check config
var bot = mineflayer.createBot({
    host: process.env.MINECRAFT_HOST ? process.env.MINECRAFT_HOST : "localhost",
    port: process.env.MINECRAFT_PORT ? process.env.MINECRAFT_PORT : 25565,
    username: process.env.BOT_USERNAME ? process.env.BOT_USERNAME : "sorter_bot",
    password: process.env.BOT_PASSWORD,
    version: false,     // auto-detect version
    auth: 'microsoft' // Comment this and the password above to use offline accounts
})

const { pathfinder, Movements } = require('mineflayer-pathfinder')
const inventoryViewer = require('mineflayer-web-inventory')
const { GoalNear, GoalFollow, GoalInvert } = require('mineflayer-pathfinder').goals;
import { Item } from 'prismarine-item';
import { Vec3 } from 'vec3';

bot.loadPlugin(pathfinder)

let activityInterval: NodeJS.Timer | null = null
let runningActivity: boolean = false
let idleInterval: NodeJS.Timer | null = null; // Controls more subtle functions
let _h = 20;
var chestNodes: ChestNode[] = [];

class ChestNode {
    type: ("potions" | "brewing" | "weapons" | "food" | "farming" | "transport" | "tools" | "armor" | "glass" | "wool" | "redstone" | "concrete" | "banner" | "building_blocks" | "ore" | "dye" | "clay" | "materials" | "music" | "misc")
    x: number
    y: number
    z: number
    full: boolean
    lastAccessed: number
    Vec3: Vec3
    allowedItems: any;
    constructor(type: "potions" | "brewing" | "weapons" | "food" | "farming" | "transport" | "tools" | "armor" | "glass" | "wool" | "redstone" | "concrete" | "banner" | "building_blocks" | "ore" | "dye" | "clay" | "materials" | "music" | "misc", x: any, y: any, z: any) {
        this.type = type
        // Just leave blank if not found
        let f = categories.find((cat: { name: string; }) => cat.name == type)
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

function setupChests() {
    chestNodes = [];//empty the list first
    //don't forget to catch specialty chests too, e.g. "Gold" would override the classifier and cause the bot to prioritize putting gold in there if it can
    bot.findBlocks({
        matching: (block: { displayName: string; }) => block.displayName == "Chest" ? true : false, count: 10
    }).forEach((block: { x: any; y: any; z: any; }) => {//searches for chests
        let signText = testAround(block.x, block.y, block.z)
        if (signText) {
            var text = signText.trim().toLowerCase()
            var entry = categories.find((category: { aliases: string | any[]; }) =>
                category.aliases.includes(text)
            )
            if (entry) {
                chestNodes.push(new ChestNode(entry.name, block.x, block.y, block.z))
                console.log(`Registered ${block} as ${entry.name}`)
            } else {
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
 */
function testAround(x: number, y: number, z: number): string | null {
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

const startSorting = () => {
    setupChests();
    if (chestNodes.length == 0) return;
    activityInterval = setInterval(() => {
        // Do not start another tick if a window is already open
        if (bot.currentWindow) return;
        let currentNode = chestNodes[0]
        if (bot.entity.position.distanceTo(currentNode.Vec3) > 3) {
            bot.pathfinder.setGoal(new GoalNear(currentNode.Vec3.x, currentNode.Vec3.y, currentNode.Vec3.z, 2))
            return;
        }
        let chest = bot.blockAt(currentNode.Vec3)
        let botItems = bot.inventory.items()
        let freeBotSlots = 0;
        let freeChestSlots = 0;
        for (let i = 9; i < 44; i++) {
            // I know those are weird numbers, but it's just how the inventory API works
            // Trust me....
            if (bot.inventory.slots[i] == null) freeBotSlots++;
        }
        chestNodes.push(chestNodes.shift() as ChestNode)
        // Make sure the block at the location isn't air
        // If it is, throw an error in the log and remove the node from the list
        let blockAt = bot.blockAt(currentNode.Vec3)
        if (blockAt.name == "air") {
            console.log(`Chest at ${currentNode.Vec3} is missing!`)
            chestNodes.shift()
            return;
        }

        // Use bot.canDigBlock to verify range of chest
        if (bot.canDigBlock(chest)) {
            bot.pathfinder.setGoal(null)
            bot.openChest(chest).then((c: { withdraw: (arg0: any, arg1: any, arg2: any) => Promise<any>; deposit: (arg0: any, arg1: any, arg2: any) => Promise<any>; close: () => any; }) => {
                currentNode.lastAccessed = Date.now()
                // Normal chest range: 0-26
                // Double chest range: 0-53
                // First identify the chest type using the window title
                let largeChest: boolean;
                let chestSlots: (Item | null)[] = [];
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
                    return new Promise<void>((resolve) => {
                        let withdrawQueue: Item[] = [];
                        setTimeout(() => {
                            // 5 second timeout
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
                            let withdraw = (item: { name: any; count: any; type: any; metadata: any; }) => {
                                console.log(`Withdrawing ${item.name} x${item.count} from ${currentNode.type}`)
                                c.withdraw(item.type, item.metadata, item.count).then(() => {
                                    freeBotSlots--;
                                    if (withdrawQueue.length >= 1) {
                                        withdraw(withdrawQueue.shift() as Item)
                                    } else {
                                        console.log("Withdrawing finished")
                                        resolve()
                                        return;
                                    }
                                })
                            }
                            withdraw(withdrawQueue.shift() as Item)
                        }
                    })
                }
                const insertItems = () => {
                    return new Promise<void>((resolve) => {
                        let depositQueue: Item[] = [];
                        setTimeout(() => {
                            // 5 second timeout
                            resolve()
                        }, 5000);
                        for (let i = 0; i < botItems.length; i++) {
                            let item = botItems[i]
                            if (item) {
                                if (currentNode.allowedItems.includes(item.name) && freeChestSlots >= 1) {
                                    depositQueue.push(item as Item)
                                }
                            }
                        }
                        if (depositQueue.length >= 1) {
                            // Start depositing
                            let deposit = (item: { name: any; count: any; type: any; metadata: any; }) => {
                                console.log(`Depositing ${item.name} x${item.count} in ${currentNode.type}`)
                                c.deposit(item.type, item.metadata, item.count).then(() => {
                                    freeChestSlots--;
                                    if (depositQueue.length >= 1) {
                                        deposit(depositQueue.shift() as Item)
                                    } else {
                                        console.log("Depositing finished")
                                        resolve()
                                        return;
                                    }
                                })
                            }
                            deposit(depositQueue.shift() as Item)
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

const resetActivity = () => {
    bot.pathfinder.setGoal(null)
    if (bot.isSleeping) bot.wake()
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
    if (activityInterval) {
        clearInterval(activityInterval)
        runningActivity = false
        activityInterval = null
    }
}

// Events

bot.on('kicked', (reason: string) => console.log("Kicked: " + reason))
bot.on('login', () => console.log("Logged in"))
bot.on('death', () => console.log("I died..."))
bot.on('error', (err: any) => console.log(err))
bot.on('entityHurt', (entity: any) => {
    if (entity == bot.entity) {
        console.log("I was hurt!")
        let closestEntity = bot.nearestEntity((e: { type: string; }) => e.type == "player" || e.type == "mob")
        if (closestEntity) {
            // Run from the closest enemy
            resetActivity()
            let timeLeft = 15
            activityInterval = setInterval(() => {
                bot.pathfinder.setGoal(new GoalInvert(new GoalFollow(closestEntity, 20)), true)
                timeLeft--;
                if (timeLeft <= 0) {
                    resetActivity()
                }
            }, 1000);
        }
    }
})
bot.on('health', () => {
    console.log("Health: " + bot.health)
    console.log("Food: " + bot.food)
    if (bot.food < 18) {
        // Eat stuff
        let foodCategory = categories.find((c: { name: string; }) => c.name == "food")
        let edibleItems = bot.inventory.items().filter((i: { name: any; }) => foodCategory.items.includes(i.name))
        if (edibleItems.length >= 1) {
            // There is an issue with this functions internal promise not being resolved
            // I think it has to do with the inventory not being updated, but I can't find the cause
            // So I'm going to disable it until my issue is fixed
            // https://github.com/PrismarineJS/mineflayer/issues/2568
            //   bot.consume().then(() => {
            //       console.log("Finished eating")
            //   }).catch((err: any) => {
            //       console.log(err)
            //   })
        }
    }
})

bot.once('spawn', () => {
    // Save to access data and start inv viewer after spawning
    var mcData = require('minecraft-data')(bot.version)
    var defaultMove = new Movements(bot, mcData)
    // inventoryViewer(bot, { port: 8080 }) // Disabled because newer textures are causing crashes

    // Restrict movement for controlled environments
    defaultMove.canDig = false;
    defaultMove.allow1by1towers = false;
    defaultMove.allowFreeMotion = true;
    bot.pathfinder.setMovements(defaultMove)

    idleInterval = setInterval(() => {
        if (!activityInterval && !runningActivity) {
            // 33% chance to look in a random direction
            // 33% chance to look in the direction of the player
            // and 33% chance to randomly walk a short distance
            if (Math.random() < 0.33) {
                // Why the hell does this have to be radians?
                let p = (Math.random() * 60 - 30) * Math.PI / 180
                bot.look(Math.random() * 360, p, true)
            } else if (Math.random() < 0.33) {
                let targetEnt = bot.nearestEntity((e: { type: string; }) => e.type == "player")
                if (targetEnt) {
                    let targetBlock = bot.blockAt(targetEnt.position)
                    if (bot.canSeeBlock(targetBlock)) {
                        bot.lookAt(targetBlock.position.offset(0, 1.6, 0))
                    }
                }
            } else if (!bot.pathfinder.goal) {
                // Each offset is a random number between -5 and 5
                let newPos = bot.entity.position.offset(Math.random() * 10 - 5, 0, Math.random() * 10 - 5)
                bot.pathfinder.setGoal(new GoalNear(newPos.x, newPos.y, newPos.z, 2))
            }
        }
    }, 2500)

    bot.on('chat', (username: string, message: string) => {
        console.log(`> ${username}: ${message}`)
        if (!controlAccounts || !controlAccounts.includes(username)) return;
        if (!message.startsWith(".")) return;
        let command = message.substring(1).split(" ")[0].toLowerCase()

        console.log(`Executing command: ${command}`)
        switch (command) {
            case "sort":
            case "start":
                resetActivity()
                startSorting()
                break;

            case "stop":
                resetActivity()
                break;

            case "quit":
                resetActivity()
                bot.quit()
                process.exit(0)
                break;

            case "here":
            case "come":
                resetActivity()
                activityInterval = null // Just to prevent the bot from moving
                runningActivity = true
                let targetEntC = bot.nearestEntity((e: { name: string; username: any; }) => e.name == "player" && e.username == username)
                if (!targetEntC) return;
                bot.pathfinder.setGoal(new GoalNear(targetEntC.position.x, targetEntC.position.y, targetEntC.position.z, 2))
                break;

            case "follow":
                resetActivity()
                activityInterval = null // Just to prevent the bot from moving
                runningActivity = true
                let targetEntF = bot.nearestEntity((e: { type: string; name: any; }) => e.type == "player" && e.name != username)
                if (!targetEntF) return;
                bot.pathfinder.setGoal(new GoalFollow(targetEntF, 2), true)
                break;

            case "sleep":
                resetActivity()
                let bed = bot.findBlock({ matching: (block: { displayName: string | string[]; }) => block.displayName.includes("Bed") && block.displayName != "Bedrock", count: 1 })
                if (bed) {
                    bot.pathfinder.setGoal(new GoalNear(bed.x, bed.y, bed.z, 2))
                    bot.sleep(bed).catch((err: any) => console.log(err))
                } else {
                    console.log("No bed found!")
                }
                break;

            default:
                console.log(`Unknown command: ${command}`)
                break;
        }
    })
})