/**
 * @File     : index.js
 * @Time     : 2024/11/26 17:08
 * @Author   : 0xNaiXi
 * @twitter  : 0xNaiXi
 * @Software : WebStorm
 * @Platform : macOS
 * */

const Logger = require("@youpaichris/logger");
const logger = new Logger();
const {NetworkType} = require("@unisat/wallet-sdk/lib/network");
const {AddressType, wallet} = require("@unisat/wallet-sdk");
const LocalWallet = wallet.LocalWallet;
const axios = require("axios");
const fs = require('fs').promises;

async function readKeysFile() {
    const content = await fs.readFile('keys.txt', 'utf-8');
    return content.split('\n')
        .filter(line => line.trim())
        .map(line => {
            const [_, privateKey] = line.split('----');
            return privateKey.trim();
        });
}

async function sign(privateKey,timestamp){
    const mainWallet = new LocalWallet(privateKey, AddressType.P2TR, NetworkType.MAINNET);
    const walletAddress = mainWallet.address;
    const message = `{"address":"${walletAddress}","receiverAddress":"${walletAddress}","timestamp":${timestamp}}`
    return await mainWallet.signMessage(message, 'ecdsa')
}

async function check(address) {
    let params = {
        'address': address
    }
    let headers = {
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "origin": "https://genesis.side.one",
        "referer": "https://genesis.side.one/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Connection": "keep-alive"
    }
    let url = "https://airdrop-api.side.one/airdrop/login/checkEligibility"

    let resp = await  axios.get(url, {params: params, headers: headers,timeout: 60000})
    // logger.debug(`${address}    Check response: ${resp.text}`)
    if(resp.data?.hasEligibility){
        logger.debug(`${address}    Check response: ${JSON.stringify(resp.data)}`)
    }
    return resp.data?.hasEligibility && !resp.data?.alreadyRegistered
}


async function submit(privateKey,publicKey){
    logger.info(`Submitting for ${publicKey}`);
    const timestamp = new Date().getTime()
    const mainWallet = new LocalWallet(privateKey, AddressType.P2TR, NetworkType.MAINNET);
    const walletAddress = mainWallet.address;
    const walletPublicKey = mainWallet.pubkey;
    const signature = await sign(privateKey,timestamp)
    let data = {
        "chain": "bitcoin",
        "wallet": "unisat",
        "publicKey": walletPublicKey,
        "address": walletAddress,
        "receiverAddress": walletAddress,
        "timestamp": timestamp.toString(),
        "signature": signature,
        // "twitterShareLink": "https://x.com/",
        // "discordToken": "eyJhbGciOiJIUzI1NiJ9"
    }
    let headers = {
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "origin": "https://genesis.side.one",
        "referer": "https://genesis.side.one/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Connection": "keep-alive"
    }
    let url = "https://airdrop-api.side.one/airdrop/login/submitRegister"
    let resp = await axios.post(url, data, {headers: headers,timeout: 60000})
    if(resp.data.code){
        logger.debug(`${walletAddress}    Submit response: ${JSON.stringify(resp.data)}`)
    }
    return resp.data.code === 0
}


async function processBatch(privateKeys, batchSize = 5) {
    const queue = [...privateKeys];
    const inProgress = new Set();
    async function processKey(privateKey) {
        try {
            const mainWallet = new LocalWallet(privateKey, AddressType.P2TR, NetworkType.MAINNET);
            const walletAddress = mainWallet.address;
            logger.info(`Processing wallet: ${walletAddress}`);
            let canClaim = false
            for (let i = 0; i < 100000000; i++) {
                try{
                    canClaim = await check(walletAddress);
                    break
                }catch (e){
                    logger.error(`${walletAddress}  Check failed for ${walletAddress}`);
                }
            }

            if (canClaim) {
                for (let i = 0; i < 100000000; i++) {
                    const success = await submit(privateKey, mainWallet.pubkey);
                    if (success) {
                        logger.success(`${walletAddress}  Claim successful for ${walletAddress}`);
                        return
                    }else{
                        logger.error(`${walletAddress}  Claim failed for ${walletAddress}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } else {
                logger.warn(`${walletAddress} Not eligible or already claimed: ${walletAddress}`);
            }
        } catch (error) {
            logger.error(`Error processing ${privateKey}: ${error.message}`);
        }
    }

    async function processNext() {
        if (queue.length === 0) return;
        const privateKey = queue.shift();
        inProgress.add(privateKey);
        try {
            await processKey(privateKey);
        } finally {
            inProgress.delete(privateKey);
            if (queue.length > 0) {
                await processNext();
            }
        }
    }
    // Start initial batch
    const initialBatch = Math.min(batchSize, queue.length);
    const startPromises = Array(initialBatch)
        .fill(0)
        .map(() => processNext());
    await Promise.all(startPromises);
}

async function main() {
    try {
        const privateKeys = await readKeysFile();
        logger.info(`Loaded ${privateKeys.length} private keys`);
        await processBatch(privateKeys, 8);
        logger.success('All processing completed');
    } catch (error) {
        logger.error(`Main error: ${error.message}`);
    }
}
main()