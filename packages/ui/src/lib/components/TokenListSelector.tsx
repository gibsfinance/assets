import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'

interface ListItem {
  key: string
  name: string
  providerKey: string
  chainId: string
  type: string
  default: boolean
}

interface SelectedList {
  key: string
  providerKey: string
}

interface TokenListSelectorProps {
  availableLists: ListItem[]
  selectedList: SelectedList | null
  onSelect: (selection: SelectedList) => void
}

export default function TokenListSelector({
  availableLists,
  selectedList,
  onSelect,
}: TokenListSelectorProps) {
  const selectedItem = selectedList
    ? availableLists.find(
        (list) =>
          list.key === selectedList.key &&
          list.providerKey === selectedList.providerKey,
      ) ?? null
    : null

  return (
    <div className="space-y-2">
      <label className="label text-sm font-medium">Select Token List</label>
      <Listbox
        value={selectedItem}
        onChange={(item) => {
          if (!item) return
          onSelect({ providerKey: item.providerKey, key: item.key })
        }}
      >
        <div className="relative">
          <ListboxButton className="select w-full text-left">
            {selectedItem
              ? `${selectedItem.name} (${selectedItem.providerKey}/${selectedItem.key})`
              : 'Choose a list...'}
          </ListboxButton>
          <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-surface-100-900 shadow-lg ring-1 ring-black/5 focus:outline-none">
            {availableLists.map((list) => (
              <ListboxOption
                key={`${list.providerKey}/${list.key}`}
                value={list}
                className={({ active, selected }) =>
                  `relative cursor-pointer select-none px-3 py-2 ${
                    active ? 'bg-secondary-600 text-white' : ''
                  } ${selected ? 'font-semibold' : ''}`
                }
              >
                {list.name} ({list.providerKey}/{list.key})
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  )
}
