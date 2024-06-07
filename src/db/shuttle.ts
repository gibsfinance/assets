import { parseAMBMessage } from "../encoded-data-parser"
import { HRE, MinimalEventData, NetworkParts } from "../types"
import { Tx, eventNames, insertIntoTable, tableNames } from "./utils"
import * as utils from '../utils'
import { getDB } from "."
import _ from "lodash"

export const generateCompleteHomeToForeign = async <T extends MinimalEventData>(
  hre: HRE,
  events: Readonly<T>[],
  t: Tx = getDB(),
) => {
  if (!events.length) return
  const messageHashes = _(events)
    .map('messageHash')
    .uniq()
    .value()
  const networkId = utils.networkToId(hre.network)
  const [pair] = networkId.split('/') as NetworkParts
  const { shuttles } = utils.deploymentSettings(pair)
  if (!shuttles?.length) return

  const originatingUserRequests = await t(eventNames.userRequestForSignature)
    .whereIn('hash', messageHashes)
  const signatures = await t(eventNames.signedForUserRequest)
    .whereIn('messageHash', messageHashes)
  const sigsByHash = _.groupBy(signatures, 'messageHash')
  const requestedRelays = _(originatingUserRequests)
    .map((req) => {
      if (req.required > sigsByHash[req.hash].length) {
        // not yet confirmed via sigs
        return null
      }
      const msg = parseAMBMessage(req.encodedData)
      const shuttle = utils.getShuttle(hre, msg)
      if (!shuttle) {
        return null
      }
      return [req, shuttle, msg] as const
    })
    .compact()
    .map(([req, shuttle, msg]) => {
      return {
        networkId,
        executor: msg.executor,
        affirmOnDestination: !!shuttle.affirmOnDestination,
        required: req.required,
        destinationNetworkId: utils.networkId(`${pair}/${shuttle.destination.side}`, msg.destinationChainId),
        receiptHash: req.transactionHash,
        encodedData: req.encodedData,
        relayRequestId: req.hash,
      }
    })
    .value()
  if (!requestedRelays.length) {
    return
  }
  await t.transaction(async (tx) => {
    // insert transaction receipts?
    await insertIntoTable(tx, tableNames.relayRequest, requestedRelays, [
      'relayRequestId',
    ], [
      'relayRequestId',
    ])
  })
}
