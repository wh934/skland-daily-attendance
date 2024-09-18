import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import { attendance, auth, signIn, getBinding } from './api'
import { bark, serverChan } from './notifications'
import { SKLAND_BOARD_IDS, SKLAND_BOARD_NAME_MAPPING } from './constant'

interface Options {
  withServerChan?: false | string
  withBark?: false | string
}

interface Account {
  token: string
  name?: string
}

async function doAttendanceForAccount(account: Account, options: Options) {
  const messages: string[] = []
  let hasError = false

  const logger = (message: string, error = false) => {
    messages.push(message)
    console[error ? 'error' : 'log'](message)
    if (error) hasError = true
  }

  try {
    logger(`开始处理账号 ${account.name || account.token.substr(0, 8)}...`)

    const { code } = await auth(account.token)
    const { cred, token: signToken } = await signIn(code)
    const { list } = await getBinding(cred, signToken)

    logger('## 明日方舟签到')
    let successAttendance = 0
    const characterList = list.flatMap(i => i.bindingList)

    for (const character of characterList) {
      try {
        logger(`正在签到第 ${successAttendance + 1} 个角色: ${character.nickName}`)
        const data = await attendance(cred, signToken, {
          uid: character.uid,
          gameId: character.channelMasterId,
        })

        if (data) {
          if (data.code === 0 && data.message === 'OK') {
            const awards = data.data.awards.map(a => `「${a.resource.name}」${a.count}个`).join(',')
            logger(`${character.nickName} (${Number(character.channelMasterId) - 1 ? 'B服' : '官服'}) 签到成功，获得了 ${awards}`)
            successAttendance++
          } else {
            logger(`${character.nickName} (${Number(character.channelMasterId) - 1 ? 'B服' : '官服'}) 签到失败: ${data.message}`, true)
          }
        } else {
          logger(`${character.nickName} (${Number(character.channelMasterId) - 1 ? 'B服' : '官服'}) 今天已经签到过了`)
        }
      } catch (error) {
        logger(`签到角色 ${character.nickName} 时发生错误: ${error.message}`, true)
      }

      await setTimeout(3000)
    }

    if (successAttendance !== 0) {
      logger(`账号 ${account.name || account.token.substr(0, 8)} 成功签到 ${successAttendance} 个角色`)
    }
  } catch (error) {
    logger(`账号 ${account.name || account.token.substr(0, 8)} 处理过程中发生错误: ${error.message}`, true)
  }

  return { messages, hasError }
}

async function sendNotifications(options: Options, title: string, content: string) {
  if (options.withServerChan) {
    await serverChan(options.withServerChan, title, content)
  }
  if (options.withBark) {
    await bark(options.withBark, title, content)
  }
}

async function main() {
  const config = {
    accounts: [
      { token: 'token1', name: 'Account1' },
      { token: 'token2', name: 'Account2' },
      // Add more accounts as needed
    ],
    serverChanToken: 'your_server_chan_token',
    barkURL: 'your_bark_url',
  }

  const options: Options = {
    withServerChan: config.serverChanToken,
    withBark: config.barkURL,
  }

  const results = await Promise.all(
    config.accounts.map(account => doAttendanceForAccount(account, options))
  )

  const allMessages = results.flatMap(result => result.messages)
  const overallStatus = results.some(result => result.hasError) ? '部分失败' : '全部成功'

  console.log('所有账号处理完毕。结果：')
  console.log(allMessages.join('\n'))

  await sendNotifications(
    options,
    `【森空岛每日签到】${overallStatus}`,
    allMessages.join('\n\n')
  )

  if (results.some(result => result.hasError)) {
    process.exit(1)
  }
}

main().catch(error => {
  console.error('程序执行过程中发生错误:', error)
  process.exit(1)
})
