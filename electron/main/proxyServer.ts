import fs from 'fs'
import log from 'electron-log'
import CONFIG from './const'
import * as urlTool from "url"
import {toSize, typeSuffix} from "./utils"
// @ts-ignore
import {hexMD5} from '../../src/common/md5'
import pkg from '../../package.json'

const hoXy = require('hoxy')

if (process.platform === 'win32') {
    process.env.OPENSSL_BIN = CONFIG.OPEN_SSL_BIN_PATH
    process.env.OPENSSL_CONF = CONFIG.OPEN_SSL_CNF_PATH
}

const resObject = {
    url: "",
    url_sign: "",
    referer: "",
    cover_url: "",
    file_format: "",
    platform: "",
    size: "",
    type: "video/mp4",
    type_str: 'video',
    progress_bar: "",
    save_path: "",
    decode_key: "",
    description: ""
}

const vv = hexMD5(pkg.version) + (CONFIG.IS_DEV ? Math.random() : "")

export function startServer(win) {
    try {
        let upstreamProxy = ""
        if (global.resdConfig.proxy && !global.resdConfig.proxy.includes(':' + global.resdConfig.port)) {
            upstreamProxy = global.resdConfig?.proxy
        }
        console.log("global.resdConfig.port:", global.resdConfig.port)
        const proxy = hoXy.createServer({
            upstreamProxy: upstreamProxy,
            certAuthority: {
                key: fs.readFileSync(CONFIG.CERT_PRIVATE_PATH),
                cert: fs.readFileSync(CONFIG.CERT_PUBLIC_PATH),
            },
        })
            .listen(global.resdConfig.port, () => {
                global.isStartProxy = true
            })
            .on('error', err => {
                console.error("hoXy err:", err);
            })
        intercept(proxy, win)
    } catch (e) {
        console.error("--------------proxy catch err--------------");
    }
}

function intercept(proxy, win) {
    proxy.intercept(
        {
            phase: 'request',
            hostname: 'res-downloader.666666.com',
            as: 'json',
        },
        (req, res) => {
            res.string = 'ok'
            res.statusCode = 200
            try {
                if (req.json?.media?.length <= 0) {
                    return
                }
                const media = req.json?.media[0]
                const url_sign: string = hexMD5(media.url)
                if (!media?.decodeKey || global.videoList.hasOwnProperty(url_sign) === true) {
                    return
                }
                const urlInfo = urlTool.parse(media.url, true)
                global.videoList[url_sign] = media.url
                win.webContents.send('on_get_queue', Object.assign({}, resObject, {
                    url_sign: url_sign,
                    url: media.url + media.urlToken,
                    cover_url: media.coverUrl,
                    referer: "",
                    file_format: media.spec.map((res) => res.fileFormat).join('#'),
                    platform: urlInfo.hostname,
                    size: toSize(media.fileSize),
                    type: "video/mp4",
                    type_str: 'video',
                    decode_key: media.decodeKey,
                    description: req.json.description,
                }))
            } catch (e) {
                log.log(e.toString())
            }
        },
    )

    proxy.intercept(
        {
            phase: 'response',
            hostname: 'channels.weixin.qq.com',
            as: 'string',
        },
        async (req, res) => {
            if (req.url.includes('/web/pages/feed') || req.url.includes('/web/pages/home')) {
                res.string = res.string.replaceAll('.js"', '.js?v=' + vv + '"')
                res.statusCode = 200
            }
        },
    )

    proxy.intercept(
        {
            phase: 'response',
            hostname: 'res.wx.qq.com',
            as: 'string',
        },
        async (req, res) => {
            if (req.url.endsWith('.js?v=' + vv)) {
                res.string = res.string.replaceAll('.js"', '.js?v=' + vv + '"');
            }
            if (req.url.includes("web/web-finder/res/js/virtual_svg-icons-register.publish")) {
                res.string = res.string.replace(/get\s*media\s*\(\)\s*\{/, `
                    get media(){
                        if(this.objectDesc){
                            fetch("https://res-downloader.666666.com", {
                              method: "POST",
                              mode: "no-cors",
                              body: JSON.stringify(this.objectDesc),
                            });
                        };
                    `)
            }
        }
    );

    proxy.intercept(
        {
            phase: 'response',
        },
        async (req, res) => {
            try {
                // 拦截响应
                const contentType = res?._data?.headers?.['content-type']
                const [resType, suffix] = typeSuffix(contentType)
                if (resType) {
                    const url_sign: string = hexMD5(req.fullUrl())
                    const res_url = req.fullUrl()
                    const urlInfo = urlTool.parse(res_url, true)
                    const contentLength = res?._data?.headers?.['content-length']
                    if (global.videoList.hasOwnProperty(url_sign) === false) {
                        global.videoList[url_sign] = res_url
                        let referer = req?._data?.headers?.['referer']
                        win.webContents.send('on_get_queue', Object.assign({}, resObject, {
                            url: res_url,
                            url_sign: url_sign,
                            referer: referer ? referer : "",
                            platform: urlInfo.hostname,
                            size: toSize(contentLength ? contentLength : 0),
                            type: contentType,
                            type_str: resType,
                        }))
                    }
                }
            } catch (e) {
                log.log("--------------proxy response err--------------", e)
            }
        },
    )
}