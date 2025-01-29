<script lang="ts">
    import { metrics } from '$lib/stores/metrics';
    import { onMount } from 'svelte';
    import { getApiUrl } from '$lib/utils';
    
    type ApiType = 'token' | 'network' | 'list';
    
    let selectedChain: number | null = null;
    let tokenAddress: string = '';
    let urlType: ApiType = 'token';
    let listName: string = 'default';
    let generatedUrl: string = '';
    let copied = false;
    let previewError = false;
    let showZoomModal = false;
    let zoomLevel = 1;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let translateX = 0;
    let translateY = 0;
    let iconExists = true;
    let showTokenList = false;
    let searchQuery = '';

    const listOptions = [
        { value: 'default', label: 'Default List' },
        { value: '9mm', label: '9mm Exchange' },
        { value: 'coingecko', label: 'CoinGecko' },
        { value: 'pancake', label: 'PancakeSwap' },
        { value: 'quickswap', label: 'QuickSwap' },
        { value: 'honeyswap', label: 'HoneySwap' }
    ];

    const fallbackIcon = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBhdGggZD0iTTggMTRzMS41IDIgNCAyIDQtMiA0LTIiLz48bGluZSB4MT0iOSIgeTE9IjkiIHgyPSI5LjAxIiB5Mj0iOSIvPjxsaW5lIHgxPSIxNSIgeTE9IjkiIHgyPSIxNS4wMSIgeTI9IjkiLz48L3N2Zz4=";

    let currentPage = 1;
    const tokensPerPage = 25;
    let allTokens: Token[] = [];
    let filteredTokens: Token[] = [];

    let isNetworkSelectOpen = false;
    let selectedNetwork = null;

    // Load metrics for chain data
    onMount(() => {
        metrics.fetchMetrics();
    });

    function generateUrl() {
        previewError = false;
        iconExists = true;
        
        switch(urlType) {
            case 'network':
                if (selectedChain) {
                    generatedUrl = getApiUrl(`/image/${selectedChain}`);
                }
                break;
            case 'token':
                if (selectedChain && tokenAddress) {
                    generatedUrl = getApiUrl(`/image/${selectedChain}/${tokenAddress}`);
                }
                break;
            case 'list':
                if (selectedChain) {
                    generatedUrl = getApiUrl(`/list/${listName}?chainId=${selectedChain}`);
                } else {
                    generatedUrl = getApiUrl(`/list/${listName}`);
                }
                break;
        }
    }

    async function copyToClipboard() {
        try {
            await navigator.clipboard.writeText(generatedUrl);
            copied = true;
            setTimeout(() => copied = false, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }

    function resetForm() {
        selectedChain = null;
        tokenAddress = '';
        generatedUrl = '';
        previewError = false;
    }

    function handleImageError() {
        previewError = true;
        iconExists = false;
        generatedUrl = '';
    }

    function handleZoomIn() {
        zoomLevel = Math.min(zoomLevel + 0.5, 4);
    }

    function handleZoomOut() {
        zoomLevel = Math.max(zoomLevel - 0.5, 0.5);
    }

    function handleMouseDown(event: MouseEvent) {
        isDragging = true;
        startX = event.clientX - translateX;
        startY = event.clientY - translateY;
    }

    function handleMouseMove(event: MouseEvent) {
        if (!isDragging) return;
        translateX = event.clientX - startX;
        translateY = event.clientY - startY;
    }

    function handleMouseUp() {
        isDragging = false;
    }

    function openZoomModal() {
        showZoomModal = true;
        zoomLevel = 1;
        translateX = 0;
        translateY = 0;
    }

    function closeZoomModal() {
        showZoomModal = false;
    }

    function getFormattedResponse(url: string) {
        let baseUrl = typeof window !== 'undefined' 
            ? ((window as any).__ipfsPath || '') 
            : '';
        
        if (window.location.hostname === 'localhost') {
            baseUrl = 'https://gib.show';
        }

        // Ensure the URL starts with the base URL
        if (!url.startsWith('http')) {
            url = `${baseUrl}${url}`;
        }

        return [
            `// GET ${url}`,
            '',
            '{',
            '  "name": "Token List",',
            '  "tokens": [',
            '    {',
            '      "chainId": number,',
            '      "address": string,',
            '      "name": string,',
            '      "symbol": string,',
            '      "decimals": number,',
            '      "logoURI": string',
            '    },',
            '    ...',
            '  ]',
            '}'
        ].join('\n');
    }

    function handleWheel(event: WheelEvent) {
        event.preventDefault();
        
        // Determine zoom direction
        const delta = -Math.sign(event.deltaY);
        const zoomStep = 0.1;
        
        if (delta > 0) {
            // Zoom in
            zoomLevel = Math.min(zoomLevel + zoomStep, 4);
        } else {
            // Zoom out
            zoomLevel = Math.max(zoomLevel - zoomStep, 0.5);
        }
    }

    function toggleTokenListPreview() {
        showTokenList = !showTokenList;
    }

    function toggleNetworkSelect() {
        isNetworkSelectOpen = !isNetworkSelectOpen;
    }

    function selectNetwork(network) {
        selectedChain = network.chainId;
        selectedNetwork = network;
        isNetworkSelectOpen = false;
        generateUrl();
    }

    interface Token {
        chainId: number;
        address: string;
        name: string;
        symbol: string;
        decimals: number;
        logoURI: string;
    }

    async function fetchTokenList(url: string): Promise<Token[]> {
        try {
            // Get the base URL using the same logic as other API calls
            let baseUrl = typeof window !== 'undefined' 
                ? ((window as any).__ipfsPath || '') 
                : '';
            
            if (window.location.hostname === 'localhost') {
                baseUrl = 'https://gib.show';
            }

            // Ensure the URL starts with the base URL
            if (!url.startsWith('http')) {
                url = `${baseUrl}${url}`;
            }

            console.log('Fetching token list from:', url);
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.error('Response not OK:', response.status, response.statusText);
                throw new Error('Failed to fetch token list');
            }
            
            const data = await response.json();
            if (!data || !Array.isArray(data.tokens)) {
                console.error('Invalid response data:', data);
                throw new Error('Invalid token list data');
            }
            
            allTokens = data.tokens;
            filteredTokens = allTokens;
            return allTokens;
        } catch (error) {
            console.error('Error fetching token list:', error);
            // Show error to user
            previewError = true;
            throw error;
        }
    }

    function getTokenUrl(token: Token): string {
        return getApiUrl(`/image/${token.chainId}/${token.address}`);
    }
</script>

<div class="container mx-auto p-8 max-w-4xl space-y-8">
    <div class="text-center space-y-4">
        <h1 class="h1">URL Wizard</h1>
        <p class="text-lg">Generate URLs for the Gib Assets API</p>
    </div>

    <div class="card p-6 space-y-6">
        <!-- API Type Selection -->
        <div class="space-y-2">
            <span class="label">What are you looking for?</span>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                <button 
                    class="btn {urlType === 'token' ? 'variant-filled-primary' : 'variant-ghost'}"
                    on:click={() => {
                        urlType = 'token';
                        generatedUrl = '';
                        previewError = false;
                    }}
                >
                    <i class="fas fa-coins mr-2"></i>
                    Token Icon
                </button>
                <button 
                    class="btn {urlType === 'network' ? 'variant-filled-primary' : 'variant-ghost'}"
                    on:click={() => {
                        urlType = 'network';
                        generatedUrl = '';
                        tokenAddress = '';
                        previewError = false;
                    }}
                >
                    <i class="fas fa-network-wired mr-2"></i>
                    Network Icon
                </button>
                <button 
                    class="btn {urlType === 'list' ? 'variant-filled-primary' : 'variant-ghost'}"
                    on:click={() => {
                        urlType = 'list';
                        generatedUrl = '';
                        previewError = false;
                    }}
                >
                    <i class="fas fa-list mr-2"></i>
                    Token List
                </button>
            </div>
        </div>

        <!-- Token List Selection (only for list type) -->
        {#if urlType === 'list'}
            <div class="space-y-2">
                <label for="list-select" class="label">Select Token List</label>
                <select 
                    id="list-select"
                    class="select" 
                    bind:value={listName}
                    on:change={() => generateUrl()}
                >
                    {#each listOptions as option}
                        <option value={option.value}>
                            {option.label}
                        </option>
                    {/each}
                </select>
            </div>
        {/if}

        <!-- Network Selection -->
        <div class="space-y-2">
            <label class="label">
                {urlType === 'list' ? 'Filter by Network (Optional)' : 'Select Network'}
            </label>
            <div class="relative">
                <button 
                    type="button"
                    class="select w-full text-left flex justify-between items-center py-2 px-3 text-sm"
                    on:click={toggleNetworkSelect}
                >
                    {#if selectedNetwork}
                        <span>{selectedNetwork.name} (Chain ID: {selectedNetwork.chainId})</span>
                    {:else}
                        <span class="text-gray-500">
                            {urlType === 'list' ? 'All Networks' : 'Choose a network...'}
                        </span>
                    {/if}
                    <i class="fas fa-chevron-down transition-transform" class:rotate-180={isNetworkSelectOpen}></i>
                </button>

                {#if isNetworkSelectOpen}
                    <div 
                        class="absolute z-50 w-full mt-1 bg-white dark:bg-[#202633] border border-gray-200 dark:border-surface-700/20 rounded-lg shadow-lg max-h-[300px] overflow-y-auto text-sm"
                    >
                        {#if urlType === 'list'}
                            <button
                                class="w-full px-3 py-1.5 text-left hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20 transition-colors"
                                on:click={() => {
                                    selectedChain = null;
                                    selectedNetwork = null;
                                    isNetworkSelectOpen = false;
                                    generateUrl();
                                }}
                            >
                                All Networks
                            </button>
                        {/if}
                        {#if $metrics}
                            {#each $metrics.networks.supported as network}
                                <button
                                    class="w-full px-3 py-1.5 text-left hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20 transition-colors"
                                    class:selected={selectedChain === network.chainId}
                                    on:click={() => selectNetwork(network)}
                                >
                                    {network.name} (Chain ID: {network.chainId})
                                </button>
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>

        <!-- Token Address Input (only for token type) -->
        {#if urlType === 'token'}
            <div class="space-y-2">
                <label for="token-address" class="label">Token Address</label>
                <input 
                    id="token-address"
                    type="text" 
                    class="input"
                    placeholder="0x..." 
                    bind:value={tokenAddress}
                    on:input={(e) => {
                        const input = e.target as HTMLInputElement;
                        tokenAddress = input.value.trim();
                        generateUrl();
                    }}
                />
            </div>
        {/if}

        <!-- After the token address input and before the Generated URL Display -->
        {#if urlType !== 'list' && previewError}
            <div class="card variant-ghost-error p-4">
                <div class="flex items-center gap-3">
                    <i class="fas fa-exclamation-circle text-error-500"></i>
                    <div class="flex-1">
                        <p class="font-medium">No icon found</p>
                        <p class="text-sm opacity-90">
                            There is no {urlType === 'token' ? 'token' : 'network'} icon available for this address yet. 
                            You can help by submitting it to <a href="https://github.com/trustwallet/assets" class="anchor" target="_blank" rel="noopener">TrustWallet Assets</a>.
                        </p>
                    </div>
                </div>
            </div>
        {/if}

        <!-- Generated URL Display (only show if URL exists and icon is found for image types) -->
        {#if generatedUrl && (urlType === 'list' || iconExists)}
            <div class="card variant-ghost p-4 space-y-2">
                <div class="flex justify-between items-center">
                    <span class="label">Generated URL</span>
                    <button 
                        class="btn btn-sm variant-soft"
                        on:click={copyToClipboard}
                    >
                        {#if copied}
                            <i class="fas fa-check mr-2"></i>
                            Copied!
                        {:else}
                            <i class="fas fa-copy mr-2"></i>
                            Copy
                        {/if}
                    </button>
                </div>
                <code class="text-sm break-all">{generatedUrl}</code>
            </div>

            <!-- Preview (only for token and network icons) -->
            {#if urlType !== 'list'}
                <div class="card variant-ghost p-4 space-y-2">
                    <span class="label">Preview</span>
                    <div class="flex justify-center p-4">
                        {#if previewError}
                            <div class="text-error-500 flex items-center gap-2">
                                <i class="fas fa-exclamation-circle"></i>
                                <span>No icon found for this {urlType === 'token' ? 'token' : 'network'} yet. Try submitting it to <a href="https://github.com/trustwallet/assets" class="anchor" target="_blank" rel="noopener">TrustWallet Assets</a>.</span>
                            </div>
                        {:else}
                            <img 
                                src={generatedUrl.replace(/^\./, 'https://gib.show')} 
                                alt="Icon preview"
                                class="w-16 h-16 rounded-full bg-surface-700 cursor-zoom-in hover:opacity-80 transition-opacity"
                                on:error={handleImageError}
                                on:click={openZoomModal}
                            />
                        {/if}
                    </div>
                </div>
            {/if}

            <!-- Response Preview for List Type -->
            {#if urlType === 'list'}
                <div class="card variant-ghost p-4 space-y-4 overflow-hidden">
                    <div class="flex justify-between items-center">
                        <span class="label">Response Preview</span>
                        <!-- Only show the toggle button for non-default lists -->
                        {#if listName !== 'default'}
                            <button 
                                class="btn btn-sm variant-soft"
                                on:click={toggleTokenListPreview}
                            >
                                <i class="fas {showTokenList ? 'fa-code' : 'fa-list'} mr-2"></i>
                                {showTokenList ? 'Show Response' : 'Show Tokens'}
                            </button>
                        {/if}
                    </div>

                    <!-- Always show formatted response for default list -->
                    {#if listName === 'default' || !showTokenList}
                        <div class="card variant-soft p-4">
                            <pre class="text-xs overflow-x-auto font-mono"><code class="block whitespace-pre text-surface-900-50-token">{getFormattedResponse(generatedUrl)}</code></pre>
                        </div>
                    {:else}
                        <!-- Token list preview content -->
                        {#await fetchTokenList(generatedUrl)}
                            <div class="p-4 text-center">
                                <i class="fas fa-spinner fa-spin mr-2"></i>
                                Loading tokens...
                            </div>
                        {:then tokens}
                            <div class="space-y-4">
                                <!-- Search and Filter -->
                                <div class="flex gap-4">
                                    <div class="input-group input-group-divider grid-cols-[auto_1fr_auto] rounded-container-token flex-1">
                                        <div class="input-group-shim">
                                            <i class="fas fa-search"></i>
                                        </div>
                                        <input 
                                            type="search" 
                                            placeholder="Search tokens..."
                                            class="input"
                                            bind:value={searchQuery}
                                            on:input={() => {
                                                currentPage = 1;
                                                filteredTokens = allTokens.filter(token => 
                                                    !searchQuery || 
                                                    token.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                                    token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                                    token.address.toLowerCase().includes(searchQuery.toLowerCase())
                                                );
                                            }}
                                        />
                                    </div>
                                    <div class="flex items-center gap-2 text-sm">
                                        <span>Showing {Math.min(tokensPerPage * currentPage, filteredTokens.length)} of {filteredTokens.length} tokens</span>
                                    </div>
                                </div>

                                <!-- Token Table -->
                                <div class="table-container overflow-x-auto w-full">
                                    <table class="table table-hover w-full">
                                        <thead>
                                            <tr>
                                                <th class="w-1/3">Token</th>
                                                <th class="w-[15%]">Symbol</th>
                                                <th class="w-[35%]">Address</th>
                                                <th class="w-[12%]">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each filteredTokens.slice((currentPage - 1) * tokensPerPage, currentPage * tokensPerPage) as token}
                                                <tr>
                                                    <td>
                                                        <div class="flex items-center gap-2">
                                                            <img 
                                                                src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                                                                alt={token.symbol}
                                                                class="w-8 h-8 rounded-full bg-surface-700"
                                                                on:error={(e) => {
                                                                    const target = e.target as HTMLImageElement;
                                                                    target.src = fallbackIcon;
                                                                }}
                                                            />
                                                            <span class="font-medium">{token.name}</span>
                                                        </div>
                                                    </td>
                                                    <td>{token.symbol}</td>
                                                    <td>
                                                        <code class="text-xs">{token.address}</code>
                                                    </td>
                                                    <td>
                                                        <div class="flex gap-2">
                                                            <button 
                                                                class="btn btn-sm variant-soft"
                                                                on:click={() => {
                                                                    navigator.clipboard.writeText(getTokenUrl(token));
                                                                }}
                                                            >
                                                                <i class="fas fa-copy"></i>
                                                            </button>
                                                            <a 
                                                                href={getTokenUrl(token)} 
                                                                target="_blank" 
                                                                rel="noopener"
                                                                class="btn btn-sm variant-soft"
                                                            >
                                                                <i class="fas fa-external-link-alt"></i>
                                                            </a>
                                                        </div>
                                                    </td>
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>

                                <!-- Pagination -->
                                <div class="flex justify-between items-center">
                                    <button 
                                        class="btn btn-sm variant-soft"
                                        disabled={currentPage === 1}
                                        on:click={() => currentPage--}
                                    >
                                        <i class="fas fa-chevron-left mr-2"></i>
                                        Previous
                                    </button>
                                    <span class="text-sm">
                                        Page {currentPage} of {Math.ceil(filteredTokens.length / tokensPerPage)}
                                    </span>
                                    <button 
                                        class="btn btn-sm variant-soft"
                                        disabled={currentPage >= Math.ceil(filteredTokens.length / tokensPerPage)}
                                        on:click={() => currentPage++}
                                    >
                                        Next
                                        <i class="fas fa-chevron-right ml-2"></i>
                                    </button>
                                </div>
                            </div>
                        {:catch error}
                            <div class="card variant-ghost-error p-4">
                                <div class="flex items-center gap-3">
                                    <i class="fas fa-exclamation-circle text-error-500"></i>
                                    <div class="flex-1">
                                        <p class="font-medium">Failed to load token list</p>
                                        <p class="text-sm opacity-90">
                                            {error.message || 'An error occurred while loading the token list.'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        {/await}
                    {/if}
                </div>
            {/if}

            <!-- Zoom Modal -->
            {#if showZoomModal && !previewError}
                <div 
                    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" 
                    on:click={closeZoomModal}
                >
                    <div 
                        class="bg-[#202633] border border-surface-700/20 p-6 rounded-lg shadow-xl w-[90vw] max-w-6xl mx-4 space-y-4"
                        on:click|stopPropagation
                    >
                        <div class="flex justify-between items-center text-white">
                            <h3 class="h3">Image Preview</h3>
                            <div class="flex gap-2">
                                <button 
                                    class="btn btn-sm variant-soft-surface"
                                    on:click={handleZoomOut}
                                    disabled={zoomLevel <= 0.5}
                                >
                                    <i class="fas fa-minus"></i>
                                </button>
                                <span class="flex items-center px-2 text-sm">
                                    {Math.round(zoomLevel * 100)}%
                                </span>
                                <button 
                                    class="btn btn-sm variant-soft-surface"
                                    on:click={handleZoomIn}
                                    disabled={zoomLevel >= 4}
                                >
                                    <i class="fas fa-plus"></i>
                                </button>
                                <button 
                                    class="btn btn-sm variant-soft-error"
                                    on:click={closeZoomModal}
                                >
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>

                        <div 
                            class="overflow-hidden rounded-lg relative h-[400px] cursor-move checkerboard bg-[#151821] border border-surface-700/20"
                            on:mousedown={handleMouseDown}
                            on:mousemove={handleMouseMove}
                            on:mouseup={handleMouseUp}
                            on:mouseleave={handleMouseUp}
                            on:wheel|preventDefault={handleWheel}
                        >
                            <img 
                                src={generatedUrl.replace(/^\./, 'https://gib.show')} 
                                alt="Icon preview"
                                class="absolute left-1/2 top-1/2 transition-transform duration-100"
                                style="transform: translate(calc(-50% + {translateX}px), calc(-50% + {translateY}px)) scale({zoomLevel})"
                            />
                        </div>

                        <div class="text-center text-sm text-gray-400">
                            <span class="opacity-75">Click and drag to pan • Scroll to zoom • Use buttons to zoom • Click outside to close</span>
                        </div>
                    </div>
                </div>
            {/if}

            <!-- Reset Button -->
            <button 
                class="btn variant-ghost-surface w-full"
                on:click={resetForm}
            >
                <i class="fas fa-redo mr-2"></i>
                Reset
            </button>
        {/if}
    </div>

    <!-- API Documentation Link -->
    <div class="text-center">
        <a 
            href="/docs" 
            class="btn variant-ghost-surface"
        >
            <i class="fas fa-book mr-2"></i>
            View Full API Documentation
        </a>
    </div>
</div>

<style>
    .label {
        @apply font-medium text-sm;
    }
    .input, .select {
        @apply w-full;
    }
    /* Prevent image dragging which interferes with pan functionality */
    img {
        -webkit-user-drag: none;
        user-select: none;
        -moz-user-select: none;
        -webkit-user-select: none;
        -ms-user-select: none;
    }

    /* Response Preview Syntax Highlighting */
    pre code {
        @apply font-mono;
    }
    
    pre code :global(.comment) {
        @apply text-surface-500;
    }
    
    pre code :global(.string) {
        @apply text-primary-500;
    }
    
    pre code :global(.type) {
        @apply text-secondary-500;
    }

    /* Checkerboard pattern for transparent image background */
    .checkerboard {
        background-color: #fff;
        background-image: linear-gradient(45deg, #ddd 25%, transparent 25%),
            linear-gradient(-45deg, #ddd 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ddd 75%),
            linear-gradient(-45deg, transparent 75%, #ddd 75%);
        background-size: 20px 20px;
        background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
    }

    /* Dark mode version */
    :global(.dark) .checkerboard {
        background-color: #2a2a2a;
        background-image: linear-gradient(45deg, #333 25%, transparent 25%),
            linear-gradient(-45deg, #333 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #333 75%),
            linear-gradient(-45deg, transparent 75%, #333 75%);
    }

    /* Add smooth transitions */
    .select {
        @apply transition-all duration-200;
    }

    /* Custom scrollbar for the dropdown */
    .overflow-y-auto {
        scrollbar-width: thin;
        scrollbar-color: #00DC82 transparent;
    }

    .overflow-y-auto::-webkit-scrollbar {
        width: 4px;
    }

    .overflow-y-auto::-webkit-scrollbar-track {
        @apply bg-transparent;
    }

    .overflow-y-auto::-webkit-scrollbar-thumb {
        @apply bg-[#00DC82]/50 rounded-full;
    }

    .selected {
        @apply bg-[#00DC82]/20;
    }
</style>

<!-- Add click outside handling -->
<svelte:window 
    on:click={(e) => {
        if (isNetworkSelectOpen && !e.target.closest('.select')) {
            isNetworkSelectOpen = false;
        }
    }}
/> 