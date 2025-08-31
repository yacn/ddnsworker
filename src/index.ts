/**
  Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */


const BAD_REQUEST = new Response("bad request", {status: 400, statusText: "Bad Request"})
enum HttpMethod {
	GET = "GET",
	POST = "POST",
	PATCH = "PATCH",
};

type CfListResult = {
	result: CloudflareDNSRecord[];
	success: boolean;
	errors: string[];
	messages: string[];
	result_info: {
		page: number;
		per_page: number;
		count: number;
		total_count: number;
		total_pages: number;
	}
}

class CloudflareDNSRecord  {
	name: string;
	zoneId: string;
	type: string;
	id?: string;
	content?: string;
	comment: string = "dynamic dns record set via worker, last updated " + new Date().toISOString();
	proxied: boolean = false;

	constructor(zoneId: string, type: string, name: string);
	constructor(zoneId: string, type: string, name: string, content: string);
	constructor(zoneId: string, type: string, name: string, content?: string, comment?: string, proxied?: boolean, cfObjectId?: string) {
		this.zoneId = zoneId;
		this.type = type;
		this.name = name;

		if (content !== undefined) {
			this.content = content;
		}
		if (comment !== undefined) {
			this.comment = comment;
		}
		if (proxied !== undefined) {
			this.proxied = proxied;
		}
		if (cfObjectId !== undefined) {
			this.id = cfObjectId;
		}
	}

	static A(zoneId: string, name: string, value: string): CloudflareDNSRecord {
		//return new CloudflareDNSRecord(zoneId, "A", name, value);
		return new this(zoneId, "A", name, value);
	}

	toString(): string {
		let parts = {
			"id": this.id,
			"content": this.content,
			"comment": this.comment,
			"proxied": this.proxied,
		}
		return Object.keys(parts).reduce((prev, key) => {
			let part = parts[key as keyof typeof parts]
			if (part === undefined) {
				return prev;
			}
			return`${prev}, ${key}: ${part}`;
		}, `DNSRecord(zoneId: ${this.zoneId}, type: ${this.type}, name: ${this.name}`) + ')';
	}


	static toAPIJSONReplacer(key: string, value: any) {
		let apiJSONProperties = ["name", "type", "comment", "content", "proxied"];
		if (apiJSONProperties.includes(key)) {
			return value;
		}
		return undefined;
	}
};

class CloudflareApiV4 {
	private baseUrl: URL;
	private authToken: string;

	constructor(authToken: string, baseUrl?: string) {
		this.authToken = authToken;
		this.baseUrl = new URL(baseUrl || "https://api.cloudflare.com/client/v4/");
	}

	async request(m: HttpMethod, path: string, body?: string, searchParams?: URLSearchParams): Promise<Response> {
		let reqUrl = new URL(path, this.baseUrl);

		if (searchParams !== undefined) {
			reqUrl.search = searchParams.toString();
		}

		let init: RequestInit<RequestInitCfProperties> = {
			method: m,
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${this.authToken}`
			},
		}

		if (body !== undefined) {
			init.body = body;
		}

		console.info({'fn': 'CloudflareAPIV4.request', method: m, url: reqUrl.toString(), body: body})
		return await fetch(reqUrl.toString(), init);
	}

	async get(path: string, searchParams?: URLSearchParams): Promise<Response> {
		return await this.request(HttpMethod.GET, path, undefined, searchParams);
	}

	async post(path: string, body?: string): Promise<Response> {
		return await this.request(HttpMethod.POST, path, body);
	}

	async patch(path: string, body?: string): Promise<Response> {
		return await this.request(HttpMethod.PATCH, path, body);
	}

	async getDNSRecord(zoneId: string, name: string): Promise<Response> {
		console.debug({'fn': 'CloudflareAPIV4.getDNSRecord', zoneId: zoneId, name: name})
		return await this.get(`zones/${zoneId}/dns_records`, new URLSearchParams({"name.exact": name}));
	}

	async createDNSRecord(record: CloudflareDNSRecord): Promise<Response> {
		console.info({'fn': 'CloudflareAPIV4.createDNSRecord', record: record})
		return await this.post(`zones/${record.zoneId}/dns_records`, JSON.stringify(record, CloudflareDNSRecord.toAPIJSONReplacer));
	}

	async updateDNSRecord(record: CloudflareDNSRecord): Promise<Response> {
		console.info({'fn': 'CloudflareAPIV4.updateDNSRecord', record: record})
		return await this.patch(`zones/${record.zoneId}/dns_records/${record.id}`, JSON.stringify(record, CloudflareDNSRecord.toAPIJSONReplacer));
	}
}

async function maybeGetCloudflareDNSRecord(cfApi: CloudflareApiV4, zoneId: string, name: string): Promise<CloudflareDNSRecord | undefined> {
	const logger = function(fn: (...data: any[]) => void, props: any) {
		const base = {'fn': 'maybeGetCloudflareDNSRecord', zoneId: zoneId, name: name};
		fn({...base, ...props})
	};
	const resp = await cfApi.getDNSRecord(zoneId, name);
	if (!resp.ok) {
		logger(console.error, {message: 'failed to get dns record', status: resp.status, statusText: resp.statusText, body: await resp.text()})
		return undefined;
	}
	const data: CfListResult = await resp.json();
	logger(console.info, {num_results: data.result.length})
	let records: CloudflareDNSRecord[] = data.result;
	if (records.length == 0) {
		logger(console.info, {message: 'does not exist'})
		return CloudflareDNSRecord.A(zoneId, name, "")
	} else if (records.length == 1) {
		logger(console.info, {message: 'found record', record: records[0]})
		return records[0];
	} else {
		logger(console.error, {message: 'failed to find object id (too many results)', num_results: data['result'].length, results: records})
		return undefined;
	}
}

async function createOrUpdateDNSRecord(cfApi: CloudflareApiV4, zoneId: string, domain: string, value: string): Promise<Response> {
	const logger = function(fn: (...data: any[]) => void, props: any) {
		const base = {'fn': 'createOrUpdateDNSRecord'};
		fn({...base, ...props})
	};
	let dnsRecord = await maybeGetCloudflareDNSRecord(cfApi, zoneId, domain);
	if (dnsRecord === undefined) {
		return new Response("internal error", {status: 500, statusText: "Internal Server Error"})
	}
	if (dnsRecord.id !== undefined) {
		if (dnsRecord.content == value) {
			logger(console.info, {message: 'no changes detected'})
			return new Response(null, {status: 204});
		}
		if (["127.0.0.1", "::1"].includes(value)) {
			return BAD_REQUEST
		}
		dnsRecord.content = value;
		logger(console.info, {message: 'updating record', newIP: value, record: dnsRecord})
		return await cfApi.updateDNSRecord(dnsRecord)
	} else {
		dnsRecord.content = value;
		logger(console.info, {message: 'creating record', record: dnsRecord})
		return await cfApi.createDNSRecord(dnsRecord)
	}
}

interface UpdateRequest {
	zone_id: string;
	record: string;	
}

export default {

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const connectingIp = request.headers.get('cf-connecting-ip');
		if (connectingIp === null) {
			return BAD_REQUEST;
		}

		const url = new URL(request.url);
		const urlPath = url.pathname;
		if (request.method == HttpMethod.GET && urlPath == '/') {
			return new Response(connectingIp + "\n", {status: 200, statusText: 'OK'})
		}

		if (request.method == HttpMethod.POST && urlPath == '/update') {
			// TODO: enforce via cloudflare WAF && use Access
			if (request.headers.get('My-Secret-Token') !== env.MY_SECRET_TOKEN) {
				return new Response("unauthorized: " + connectingIp + '\n', {status: 401, statusText: "Unauthorized"});
			}
			let body: UpdateRequest = await request.json();
			let zoneId = body.zone_id;
			let domain = body.record

			if (zoneId === null || zoneId === "" || domain === null || domain === "") {
				return BAD_REQUEST
			}

			let cfApi = new CloudflareApiV4(env.CF_TOKEN);
			return createOrUpdateDNSRecord(cfApi, zoneId, domain, connectingIp)
		}

		return BAD_REQUEST;
	},

} satisfies ExportedHandler<Env>;
