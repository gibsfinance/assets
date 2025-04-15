// import { writable } from 'svelte/store'

import _ from 'lodash'
import { untrack } from 'svelte'
import { browser } from '$app/environment'

export const defaultAfter = <T>(_v: T) => {}

export type Actions<T> = {
  validation: typeof _.isEqual
  after: typeof defaultAfter<T>
}

export const defaultActions = {
  validation: _.isEqual,
  after: defaultAfter,
}

export class Proxy<T> {
  protected actions: Actions<T>
  protected val = $state(null as unknown as T)
  get value() {
    return this.val
  }
  set value(v: T) {
    if (untrack(() => this.actions.validation(this.val, v))) return
    this.val = v
    this.actions.after(v)
  }
  constructor(value: T, actionInputs: Partial<Actions<T>> = {}) {
    this.val = value
    this.actions = {
      ...defaultActions,
      ...actionInputs,
    }
  }
}

export class NullableProxy<T> extends Proxy<T | null> {
  constructor(v?: T | null, actions?: Partial<Actions<T | null>>) {
    super(v ?? null, actions)
  }
}

const showTestnetKey = 'showTestnets'
const readShowTestnets = browser ? localStorage.getItem(showTestnetKey) === 'true' : false
export const showTestnets = new Proxy<boolean>(readShowTestnets, {
  after: !browser
    ? _.noop
    : (v) => {
        localStorage.setItem(showTestnetKey, `${v}`)
      },
})
