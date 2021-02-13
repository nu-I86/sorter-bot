const mineflayer = require('mineflayer')
const config = require('./config.json')
require('dotenv').config();//read the env


//remember to finish the building blocks category
//problem with bot thinking it took items, when it actually didn't
//making it async seems to make no difference

//check config
if (!process.env.BOT_OWNER) throw new Error("Owner not specified!")
const bot = mineflayer.createBot({
    host: process.env.TARGET_HOST ? process.env.TARGET_HOST : "localhost",
    port: process.env.TARGET_PORT ? process.env.TARGET_PORT : 25565,
    username: process.env.BOT_USERNAME ? process.env.BOT_USERNAME : "sorter_bot",
    //password: process.env.PASSWORD,//only uncomment if using a real server, which is not recommended
    version: false     // false corresponds to auto version detection (that's the default), put for example "1.8.8" if you need a specific version
})

const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { GoalNear, GoalBlock, GoalXZ, GoalY, GoalInvert, GoalFollow } = require('mineflayer-pathfinder').goals;
const { Vec3 } = require('vec3');
const { Item } = require('prismarine-item');

/** @type {Movements} */
var defaultMove;
var mcData;

//If you decide to manually configure this script, don't change anything below this line
//it may lead to undesired results

/** @type {null|"sorting"} */
var currentActivity = null;
/** @type {Destination[]} */
//Cycles through the chests in order, and shifts them to the back once interacted with
var allDestinations = []
/** @type {mineflayer.Chest} Used for storage operations */
var currentChestBlock;
/** @type {boolean} If true, the bot will prioritize emptying the deposit chest  */
var dedicatedDepositMode;//this will most likely complicate the bots travel path
/** @type {Item[]} */
var itemDepositQueue = []
/** @type {Item[]} */
var itemWithdrawQueue = []


//load and configure plugins
bot.loadPlugin(pathfinder)
const inventoryViewer = require('mineflayer-web-inventory')
let invViewerOps = {
    port: 8080
}

//#region Classes
/**
 * Attaches a useful category label to chests for the bot
 */
class Destination {
    /**
     * @param {"potions"|"brewing"|"weapons"|"food"|"farming"|"transport"|"tools"|"armor"|"glass"|"wool"|"redstone"|"concrete"|"banner"|"building_blocks"|"ore"|"dye"|"clay"|"materials"|"music"|"misc"} 
     *type The category seen by the bot - REQUIRED
     */
    constructor(type, x, y, z) {
        this.type = type
        //just leave blank if not found
        this.allowedItems = config.categories.find(cat => cat.name == type) ? config.categories.find(cat => cat.name == type).items : []
        this.x = x
        this.y = y
        this.z = z
        //for convenience
        this.Vec3 = new Vec3(x, y, z)
    }
}
//#endregion

console.log("Starting bot")
//#region Events
bot.on('kicked', (reason, loggedIn) => console.log(reason, loggedIn))
bot.on('login', () => {
    console.log("Logged in")

})
bot.on('death', () => console.log("I died..."))
bot.on('error', err => console.log(err))

bot.once('spawn', () => {
    // Save to access data and start inv viewer after spawning
    const mcData = require('minecraft-data')(bot.version)
    inventoryViewer(bot, invViewerOps)

    // We create different movement generators for different type of activity
    const defaultMove = new Movements(bot, mcData)
    //restrict movement because it's designed for safe, controlled environments
    defaultMove.canDig = false;
    defaultMove.allow1by1towers = false;
    defaultMove.allowParkour = false;
    defaultMove.allowFreeMotion = false;

    bot.on('goal_reached', (goal) => {
        console.log(`Moved to (${goal.x}, ${goal.y}, ${goal.z})`)
        if (currentActivity == "sorting" && allDestinations.length > 0) {
            let chest = allDestinations[0]
            let block = bot.blockAt(chest.Vec3)
            bot.lookAt(chest.Vec3).then(() => {
                currentChestBlock = bot.openChest(block)//open it
            })
        }
    })

    bot.on('chat', (username, message) => {
        if (username != process.env.BOT_OWNER) return//ignore anybody not on the list

        const target = bot.players[username] ? bot.players[username].entity : null
        if (message === 'come') {
            if (!target) {
                bot.chat('I don\'t see you !')
                return
            }
            const p = target.position

            currentActivity = null;
            bot.pathfinder.setMovements(defaultMove)
            bot.pathfinder.setGoal(new GoalNear(p.x, p.y, p.z, 1))
        } else if (message.startsWith('goto')) {
            const cmd = message.split(' ')

            if (cmd.length === 4) { // goto x y z
                const x = parseInt(cmd[1], 10)
                const y = parseInt(cmd[2], 10)
                const z = parseInt(cmd[3], 10)

                bot.pathfinder.setMovements(defaultMove)
                bot.pathfinder.setGoal(new GoalBlock(x, y, z))
            } else if (cmd.length === 3) { // goto x z
                const x = parseInt(cmd[1], 10)
                const z = parseInt(cmd[2], 10)

                bot.pathfinder.setMovements(defaultMove)
                bot.pathfinder.setGoal(new GoalXZ(x, z))
            } else if (cmd.length === 2) { // goto y
                const y = parseInt(cmd[1], 10)

                bot.pathfinder.setMovements(defaultMove)
                bot.pathfinder.setGoal(new GoalY(y))
            }
        } else if (message === 'follow') {
            bot.pathfinder.setMovements(defaultMove)
            bot.pathfinder.setGoal(new GoalFollow(target, 3), true)
            // follow is a dynamic goal: setGoal(goal, dynamic=true)
            // when reached, the goal will stay active and will not
            // emit an event
        } else if (message === 'avoid') {
            bot.pathfinder.setMovements(defaultMove)
            bot.pathfinder.setGoal(new GoalInvert(new GoalFollow(target, 5)), true)
        } else if (message === 'stop') {
            bot.pathfinder.setGoal(null)
            currentActivity = null;
        } else if (message === 'sort') {
            //register chests
            setupChests(bot)
        } else if (message === "sayitems") {
            let output = bot.inventory.items().map((i) => i.name).join(', ')
            if (output) {
                bot.chat(output)
            } else {
                bot.chat('empty')
            }

        }
    })

    bot.on('windowOpen', (window) => {
        if ((window.type == "minecraft:chest" || window.type == "minecraft:generic_9x3" || window.type == "minecraft:generic_9x6") && currentActivity == "sorting") {
            //during normal operation
            var currentChest = allDestinations[0]
            var chestRange = { start: 0, end: 26 }
            if (window.title == '{"translate":"container.chestDouble"}' || window.type == "minecraft:generic_9x6") chestRange.end = 53
            var chestInv;//has to change inventory slots depending on the size of the chest
            window.title == '{"translate":"container.chestDouble"}' || window.type == "minecraft:generic_9x6" ? chestInv = window.itemsRange(0, 53) : chestInv = window.itemsRange(0, 26)
            var botInv = bot.inventory.items()

            //first see if it needs to put anything in there
            botInv.forEach(item => {
                if (item) {
                    let emptyChestSlot = window.firstEmptySlotRange(0, chestRange.end)
                    //if it should be in the chest
                    if (currentChest.allowedItems.includes(item.name)) {
                        //and free space in the chest
                        if (emptyChestSlot || emptyChestSlot == 0) {
                            //let the que manager deposit
                            itemDepositQueue.push(item)
                        } else {
                            console.log("This chest is full")
                        }
                    }
                }
            })

            //now check for stuff it should take
            chestInv.forEach(item => {
                if (item) {
                    //if not allowed to be there
                    if (!currentChest.allowedItems.includes(item.name)) {
                        //and free space in inventory
                        if (bot.inventory.emptySlotCount() > 0) {
                            //let the que manager withdraw it
                            itemWithdrawQueue.push(item)
                        } else {
                            console.log(`Tried to take an item, but my inventory is full`)
                        }
                    }
                }
            })


        }
    })
})
//#endregion

//#region Functions

/**
 * Scans and returns any chests it finds, or null if it can't find any
 * @param {mineflayer.Bot} bot The bot that will setup its chests
 * @returns {Destination[]|null} The results of the search. Can be null
 */
function setupChests(bot) {
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
                allDestinations.push(new Destination(entry.name, block.x, block.y, block.z))
                bot.chat(`Registered ${block} as ${entry.name}`)
                console.log(`Registered ${block} as ${entry.name}`)
            } else {
                bot.chat(`Just a heads up, I'm not sure how to categorize "${text}," so I'll ignore it`)
                console.log(`I wasn't sure how to categorize ${text}`)
            }
        }
    })
    if (allDestinations.length > 0) {
        let o = allDestinations[0].Vec3
        bot.pathfinder.setGoal(new GoalNear(o.x, o.y, o.z, 2))
        currentActivity = "sorting"
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

//deposits or extracts items
setInterval(async () => {
    //bots ability to use inventories seems to be affected by the amount of time given, how unfortunate
    if (currentChestBlock) {
        //make sure the window is open too, just for good measure
        if (currentChestBlock.window) {

            if (itemDepositQueue.length > 0) {
                //prioritizes depositing
                let item = itemDepositQueue[0]
                console.log(`Depositing ${item.name} x${item.count}`)
                currentChestBlock.window.selectedItem = item
                await currentChestBlock.deposit(item.type, item.metadata, item.count, (err) => {
                    if (err) console.log(err)
                }).then(() => {
                    itemDepositQueue.shift()
                })
            }
            if (itemWithdrawQueue.length > 0) {
                //then withdraw if it needs to
                let item = itemWithdrawQueue[0]
                console.log(`Withdrawing ${item.name} x${item.count}`)
                currentChestBlock.window.selectedItem = item
                await currentChestBlock.withdraw(item.type, item.metadata, item.count, (err) => {
                    if (err) console.log(err)
                }).then(() => {
                    itemWithdrawQueue.shift()
                })

            }
        }
    } else {
        //items should never be in the queue without a destination
        if (itemDepositQueue.length > 0) {
            console.log("Items were in the deposit que without a destination!")
            itemDepositQueue = []
        }
        if (itemWithdrawQueue.length > 0) {
            console.log("Items were in the withdraw que without a destination!")
            itemWithdrawQueue = []
        }
    }
}, 500);

setInterval(() => {
    //only moves on when its done with the chest
    if (itemDepositQueue.length == 0 && itemWithdrawQueue.length == 0 && currentChestBlock) {
        if (currentChestBlock.window) {
            if (currentChestBlock.window.selectedItem) {
                console.log("Still holding an item!")
            } else {
                //moves it to the back of the queue
                allDestinations.push(allDestinations.shift())
                bot.closeWindow(currentChestBlock.window)
                currentChestBlock = null;
                //set the next target
                let nextVec3 = allDestinations[0].Vec3
                bot.pathfinder.setGoal(new GoalNear(nextVec3.x, nextVec3.y, nextVec3.z, 2))
            }
        }
    } else if (!currentActivity && currentChestBlock) {
        //if its told to stop while in a chest
        bot.closeWindow(currentChestBlock.window)
    }
}, 3000);

//#endregion