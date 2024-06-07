import Debug from 'debug'

const icon = '📷'
process.env.DEBUG = process.env.DEBUG || `${icon}*`

// console.log('%o debug settings %o', new Date(), process.env.DEBUG)

export const log = Debug(icon)

export const timerLog = log.extend('time', ':')
