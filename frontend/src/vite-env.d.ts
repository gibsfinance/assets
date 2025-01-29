/// <reference types="vite/client" />

interface Window {
	__ipfsBase: string;
	__vite_is_modern_browser: boolean;
	__vite_fix_dynamic_import: (path: string) => string;
} 