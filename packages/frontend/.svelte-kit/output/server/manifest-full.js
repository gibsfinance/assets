export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["favicon.png"]),
	mimeTypes: {".png":"image/png"},
	_: {
		client: {start:"_app/immutable/entry/start.CFbXq6Nr.js",app:"_app/immutable/entry/app.38IdJzsV.js",imports:["_app/immutable/entry/start.CFbXq6Nr.js","_app/immutable/chunks/B8ucJFDI.js","_app/immutable/chunks/DBXYh_63.js","_app/immutable/chunks/CJlMznZ3.js","_app/immutable/entry/app.38IdJzsV.js","_app/immutable/chunks/DBXYh_63.js","_app/immutable/chunks/DgHgH_0l.js","_app/immutable/chunks/hGduFvdG.js","_app/immutable/chunks/posRgAO-.js","_app/immutable/chunks/CJlMznZ3.js","_app/immutable/chunks/B6TRhLhZ.js","_app/immutable/chunks/D2OaVOa8.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js'))
		],
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/docs",
				pattern: /^\/docs\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/wizard",
				pattern: /^\/wizard\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
