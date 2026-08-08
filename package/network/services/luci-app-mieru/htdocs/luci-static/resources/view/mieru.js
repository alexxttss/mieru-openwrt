'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require poll';
'require request';
'require dom';
'require fs';

// RPC calls to custom ucode plugin
const callMieruStatus = rpc.declare({
	object: 'luci.mieru',
	method: 'getStatus'
});

const callMieruPing = rpc.declare({
	object: 'luci.mieru',
	method: 'pingServer'
});

const callMieruTcpConnect = rpc.declare({
	object: 'luci.mieru',
	method: 'tcpConnect'
});

const callMieruValidate = rpc.declare({
	object: 'luci.mieru',
	method: 'validateConfig'
});

const callMieruTestSocks = rpc.declare({
	object: 'luci.mieru',
	method: 'testSocks5'
});

const callMieruReadLog = rpc.declare({
	object: 'luci.mieru',
	method: 'readLog'
});

const callMieruClearLog = rpc.declare({
	object: 'luci.mieru',
	method: 'clearLog'
});

// Backup & Restore RPCs
const callMieruExportBackup = rpc.declare({
	object: 'luci.mieru',
	method: 'exportBackup'
});

const callMieruImportBackup = rpc.declare({
	object: 'luci.mieru',
	method: 'importBackup'
});

const callMieruConfirmRestore = rpc.declare({
	object: 'luci.mieru',
	method: 'confirmRestore'
});

const callMieruGetBackups = rpc.declare({
	object: 'luci.mieru',
	method: 'getBackups'
});

const callMieruDeleteBackup = rpc.declare({
	object: 'luci.mieru',
	method: 'deleteBackup'
});

const callMieruRestoreBackup = rpc.declare({
	object: 'luci.mieru',
	method: 'restoreBackup'
});

const callMieruResetConfig = rpc.declare({
	object: 'luci.mieru',
	method: 'resetConfig'
});

const callMieruImportJson = rpc.declare({
	object: 'luci.mieru',
	method: 'importJson'
});

const callMieruConfirmImportJson = rpc.declare({
	object: 'luci.mieru',
	method: 'confirmImportJson'
});

const callMieruCreateManualBackup = rpc.declare({
	object: 'luci.mieru',
	method: 'createManualBackup'
});

// Standard rc service calls
const callInitAction = rpc.declare({
	object: 'rc',
	method: 'init',
	params: [ 'name', 'action' ]
});

// Parse Mieru URL
function parseMieruUrl(url) {
	url = (url || '').trim();
	if (!url.startsWith('mieru://') && !url.startsWith('mierus://')) return null;

	try {
		const parts = url.split('?');
		const base = parts[0];
		const query = parts[1] || '';

		const m = base.match(/^mierus?:\/\/([^:]+):([^@]+)@([^\/]+)$/);
		if (!m) return null;

		let username = decodeURIComponent(m[1]);
		let password = decodeURIComponent(m[2]);
		let hostStr = m[3];
		let server = hostStr;
		let port = null;

		if (hostStr.includes(':') && !hostStr.startsWith('[')) {
			const hp = hostStr.split(':');
			server = hp[0];
			port = parseInt(hp[1], 10);
		}

		let protocol = 'TCP';
		let socks5_port = 1080;
		let mtu = 1400;

		const pairs = query.split('&');
		for (let i = 0; i < pairs.length; i++) {
			const kv = pairs[i].split('=');
			if (kv.length === 2) {
				const k = kv[0].trim();
				const v = decodeURIComponent(kv[1].trim());
				if (k === 'port') port = parseInt(v, 10);
				else if (k === 'protocol') protocol = v.toUpperCase();
				else if (k === 'socks5_port') socks5_port = parseInt(v, 10);
				else if (k === 'mtu') mtu = parseInt(v, 10);
			}
		}

		if (!port || isNaN(port)) return null;

		return { server, port, username, password, protocol, socks5_port, mtu };
	} catch (e) {
		return null;
	}
}

// Apply parsed config directly to LuCI Form input widgets on page
function applyParsedConfigToForm(parsed) {
	if (!parsed) return false;

	const map = {
		server: parsed.server,
		port: '' + parsed.port,
		username: parsed.username,
		password: parsed.password,
		protocol: parsed.protocol,
		socks5_port: parsed.socks5_port ? ('' + parsed.socks5_port) : null,
		mtu: parsed.mtu ? ('' + parsed.mtu) : null
	};

	let count = 0;
	for (let key in map) {
		const val = map[key];
		if (val === null || val === undefined) continue;

		const el = document.querySelector(`[name="cbid.mieru.main.${key}"]`) || 
				   document.getElementById(`cbid.mieru.main.${key}`);
		
		if (el) {
			el.value = val;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
			count++;
		}
	}
	return count > 0;
}

// Global paste handler to automatically capture Mieru URL anywhere on the page
document.addEventListener('paste', function(ev) {
	const pasted = (ev.clipboardData || window.clipboardData)?.getData('text');
	if (pasted && (pasted.startsWith('mieru://') || pasted.startsWith('mierus://'))) {
		const parsed = parseMieruUrl(pasted);
		if (parsed) {
			ev.preventDefault();
			applyParsedConfigToForm(parsed);
			ui.addNotification(null, E('p', _('✓ Ссылка распарсена! Все поля формы автоматически заполнены.')), 'ok');
		}
	}
});

function drawSparkline(canvas, history) {
	if (!canvas) return;
	const ctx = canvas.getContext('2d');
	const w = canvas.width;
	const h = canvas.height;
	ctx.clearRect(0, 0, w, h);

	if (!history || history.length === 0) {
		ctx.font = '12px sans-serif';
		ctx.fillStyle = 'rgba(128, 128, 128, 0.6)';
		ctx.fillText(_('No data available'), w / 2 - 50, h / 2 + 4);
		return;
	}

	let maxVal = 100;
	for (let i = 0; i < history.length; i++) {
		const val = history[i];
		if (val !== null && val > maxVal) {
			maxVal = val;
		}
	}
	maxVal = maxVal * 1.1;

	const len = history.length;
	const step = w / (len - 1 || 1);

	// Grid lines
	ctx.strokeStyle = 'rgba(128, 128, 128, 0.12)';
	ctx.lineWidth = 0.5;
	for (let y = 0.25; y < 1; y += 0.25) {
		ctx.beginPath();
		ctx.moveTo(0, h * y);
		ctx.lineTo(w, h * y);
		ctx.stroke();
	}

	// Latency path
	ctx.beginPath();
	let started = false;
	for (let i = 0; i < len; i++) {
		const val = history[i];
		const x = i * step;

		if (val === null) {
			started = false;
			continue;
		}

		const y = h - (val / maxVal) * h;

		if (!started) {
			ctx.moveTo(x, y);
			started = true;
		} else {
			ctx.lineTo(x, y);
		}
	}

	ctx.strokeStyle = '#00f2fe';
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// Gradient fill
	ctx.lineTo(w, h);
	ctx.lineTo(0, h);
	ctx.closePath();
	const grad = ctx.createLinearGradient(0, 0, 0, h);
	grad.addColorStop(0, 'rgba(0, 242, 254, 0.15)');
	grad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
	ctx.fillStyle = grad;
	ctx.fill();
}

function formatSize(bytes) {
	if (bytes === 0 || !bytes) return '0 Б';
	const k = 1024;
	const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytes_per_sec) {
	if (bytes_per_sec === 0 || !bytes_per_sec) return '0 Б/с';
	const k = 1024;
	const sizes = ['Б/с', 'КБ/с', 'МБ/с', 'ГБ/с'];
	const i = Math.floor(Math.log(bytes_per_sec) / Math.log(k));
	return parseFloat((bytes_per_sec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
	if (!seconds) return '0 с';
	const d = Math.floor(seconds / (3600*24));
	const h = Math.floor((seconds % (3600*24)) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	let res = '';
	if (d > 0) res += d + ' д ';
	if (h > 0 || d > 0) res += h + ' ч ';
	if (m > 0 || h > 0 || d > 0) res += m + ' м ';
	res += s + ' с';
	return res;
}

function base64ToArrayBuffer(base64) {
	const binary_string = window.atob(base64);
	const len = binary_string.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary_string.charCodeAt(i);
	}
	return bytes.buffer;
}

function copyTextToClipboard(text) {
	if (navigator.clipboard && navigator.clipboard.writeText) {
		return navigator.clipboard.writeText(text);
	}
	
	const textArea = document.createElement("textarea");
	textArea.value = text;
	textArea.style.position = "fixed";
	textArea.style.top = "0";
	textArea.style.left = "0";
	textArea.style.width = "2em";
	textArea.style.height = "2em";
	textArea.style.padding = "0";
	textArea.style.border = "none";
	textArea.style.outline = "none";
	textArea.style.boxShadow = "none";
	textArea.style.background = "transparent";
	document.body.appendChild(textArea);
	textArea.focus();
	textArea.select();
	
	let success = false;
	try {
		success = document.execCommand('copy');
	} catch (err) {}
	
	document.body.removeChild(textArea);
	if (success) {
		return Promise.resolve();
	} else {
		return Promise.reject(new Error("Copy failed"));
	}
}

return view.extend({
	pollInterval: 5,

	load: function() {
		return Promise.all([
			uci.load('mieru'),
			callMieruGetBackups()
		]);
	},

	updateStatus: function(res) {
		const statusText = document.getElementById('mieru_status_text');
		const latencyText = document.getElementById('mieru_latency_text');
		const canvas = document.getElementById('mieru_history_canvas');
		const serviceStatus = document.getElementById('mieru_service_status');
		
		const valPid = document.getElementById('mieru_val_pid');
		const valUptime = document.getElementById('mieru_val_uptime');
		const valMem = document.getElementById('mieru_val_mem');
		const valSocks = document.getElementById('mieru_val_socks');
		const valServer = document.getElementById('mieru_val_server');
		const valConnUptime = document.getElementById('mieru_val_conn_uptime');
		const valReconns = document.getElementById('mieru_val_reconns');
		const valLastSuccess = document.getElementById('mieru_val_last_success');
		const valLastError = document.getElementById('mieru_val_last_error');
		const valLastUpdate = document.getElementById('mieru_val_last_update');

		// Detailed stats
		const valLatMin = document.getElementById('mieru_val_lat_min');
		const valLatMax = document.getElementById('mieru_val_lat_max');
		const valLatAvg = document.getElementById('mieru_val_lat_avg');
		const valActConns = document.getElementById('mieru_val_act_conns');
		const valTrafficTotal = document.getElementById('mieru_val_traffic_total');
		const valSpeedRx = document.getElementById('mieru_val_speed_rx');
		const valSpeedTx = document.getElementById('mieru_val_speed_tx');
		const valSpeedAvgRx = document.getElementById('mieru_val_speed_avg_rx');
		const valSpeedAvgTx = document.getElementById('mieru_val_speed_avg_tx');

		// Self monitoring
		const valCpuM = document.getElementById('mieru_val_cpu_m');
		const valMemM = document.getElementById('mieru_val_mem_m');
		const valShellM = document.getElementById('mieru_val_shell_m');

		// Control buttons
		const btnStart = document.getElementById('mieru_btn_start');
		const btnStop = document.getElementById('mieru_btn_stop');
		const btnRestart = document.getElementById('mieru_btn_restart');
		const btnTestSocks = document.getElementById('mieru_btn_testsocks');

		if (valLastUpdate) {
			valLastUpdate.innerText = new Date().toLocaleTimeString();
		}

		if (!res || !res.process || !res.process.running) {
			if (serviceStatus) serviceStatus.innerHTML = '<span style="color:#d9534f;font-weight:bold;">● ' + _('Stopped') + '</span>';
			if (statusText) {
				statusText.innerText = _('Offline');
				statusText.style.color = '#d9534f';
			}
			if (latencyText) latencyText.innerText = '-';
			drawSparkline(canvas, []);
			
			if (valPid) valPid.innerText = '-';
			if (valUptime) valUptime.innerText = '-';
			if (valMem) valMem.innerText = '-';
			if (valSocks) valSocks.innerText = '-';
			if (valServer) valServer.innerText = '-';
			if (valConnUptime) valConnUptime.innerText = '-';
			if (valReconns) valReconns.innerText = '-';
			if (valLastSuccess) valLastSuccess.innerText = '-';
			if (valLastError) valLastError.innerText = '-';

			if (valLatMin) valLatMin.innerText = '-';
			if (valLatMax) valLatMax.innerText = '-';
			if (valLatAvg) valLatAvg.innerText = '-';
			if (valActConns) valActConns.innerText = '-';
			if (valTrafficTotal) valTrafficTotal.innerText = '-';
			if (valSpeedRx) valSpeedRx.innerText = '-';
			if (valSpeedTx) valSpeedTx.innerText = '-';
			if (valSpeedAvgRx) valSpeedAvgRx.innerText = '-';
			if (valSpeedAvgTx) valSpeedAvgTx.innerText = '-';

			if (valCpuM) valCpuM.innerText = '-';
			if (valMemM) valMemM.innerText = '-';
			if (valShellM) valShellM.innerText = '-';

			if (btnStart) btnStart.removeAttribute('disabled');
			if (btnStop) btnStop.setAttribute('disabled', 'true');
			if (btnRestart) btnRestart.setAttribute('disabled', 'true');
			if (btnTestSocks) btnTestSocks.setAttribute('disabled', 'true');
			return;
		}

		// Process running
		if (serviceStatus) serviceStatus.innerHTML = '<span style="color:#5cb85c;font-weight:bold;">● ' + _('Running') + '</span>';
		if (valPid) valPid.innerText = res.process.pid;
		if (valUptime) valUptime.innerText = formatUptime(res.process.uptime);

		if (btnStart) btnStart.setAttribute('disabled', 'true');
		if (btnStop) btnStop.removeAttribute('disabled');
		if (btnRestart) btnRestart.removeAttribute('disabled');
		if (btnTestSocks) btnTestSocks.removeAttribute('disabled');

		const stat = res.status || {};
		
		if (valMem) valMem.innerText = stat.memory ? stat.memory + ' ' + _('MB') : formatSize(res.process.memory);

		// Server Connection Status
		if (statusText) {
			if (stat.status === 'Online') {
				statusText.innerText = _('Online');
				statusText.style.color = '#5cb85c';
			} else if (stat.status === 'Degraded') {
				statusText.innerText = _('Degraded');
				statusText.style.color = '#f0ad4e';
			} else {
				statusText.innerText = _('Offline');
				statusText.style.color = '#d9534f';
			}
		}

		if (latencyText) {
			latencyText.innerText = stat.latency ? stat.latency + ' ' + _('ms') : _('Timeout');
		}

		// Sparkline
		drawSparkline(canvas, stat.latency_history || []);

		// Details
		const cfgServer = uci.get('mieru', 'main', 'server');
		const cfgPort = uci.get('mieru', 'main', 'port');
		const cfgSocksPort = uci.get('mieru', 'main', 'socks5_port') || '1080';

		if (valSocks) valSocks.innerText = '0.0.0.0:' + cfgSocksPort;
		if (valServer) valServer.innerText = (cfgServer || '-') + ':' + (cfgPort || '-');
		if (valConnUptime) valConnUptime.innerText = formatUptime(stat.connection_uptime);
		if (valReconns) valReconns.innerText = stat.reconnect_count ?? '0';
		if (valLastSuccess) valLastSuccess.innerText = stat.last_success || '-';
		
		if (valLastError) {
			valLastError.innerText = stat.last_error || '-';
			if (stat.status !== 'Online' && stat.last_error) {
				valLastError.style.color = '#d9534f';
			} else {
				valLastError.style.color = '';
			}
		}

		// Detailed Connection Stats
		if (valLatMin) valLatMin.innerText = stat.latency_min ? stat.latency_min + ' ' + _('ms') : '-';
		if (valLatMax) valLatMax.innerText = stat.latency_max ? stat.latency_max + ' ' + _('ms') : '-';
		if (valLatAvg) valLatAvg.innerText = stat.latency_avg ? stat.latency_avg + ' ' + _('ms') : '-';
		if (valActConns) valActConns.innerText = stat.active_connections ?? '0';
		if (valTrafficTotal) {
			const rx = stat.rx_bytes || 0;
			const tx = stat.tx_bytes || 0;
			const total = rx + tx;
			valTrafficTotal.innerText = formatSize(total) + ' (' + formatSize(rx) + ' ↓ / ' + formatSize(tx) + ' ↑)';
		}
		if (valSpeedRx) valSpeedRx.innerText = formatSpeed(stat.rx_speed);
		if (valSpeedTx) valSpeedTx.innerText = formatSpeed(stat.tx_speed);
		if (valSpeedAvgRx) valSpeedAvgRx.innerText = formatSpeed(stat.rx_speed_avg);
		if (valSpeedAvgTx) valSpeedAvgTx.innerText = formatSpeed(stat.tx_speed_avg);

		// Self-monitoring stats
		if (valCpuM) valCpuM.innerText = (stat.monitor_cpu ?? '0.0') + ' %';
		if (valMemM) valMemM.innerText = (stat.monitor_mem ?? '0.0') + ' ' + _('MB');
		if (valShellM) valShellM.innerText = stat.shell_command_count ?? '0';
	},

	renderBackupsList: function(backups) {
		const tbody = document.getElementById('mieru_backups_tbody');
		if (!tbody) return;
		tbody.innerHTML = '';

		if (!backups || backups.length === 0) {
			tbody.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td center', 'colspan': 8 }, E('em', {}, _('No backups available.')))
			]));
			return;
		}

		backups.forEach(bk => {
			tbody.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, bk.date),
				E('td', { 'class': 'td left' }, formatSize(bk.size)),
				E('td', { 'class': 'td left' }, bk.mieru_version),
				E('td', { 'class': 'td left' }, bk.package_version),
				E('td', { 'class': 'td left' }, bk.openwrt_version),
				E('td', { 'class': 'td left' }, bk.device_name),
				E('td', { 'class': 'td left' }, bk.comment || '-'),
				E('td', { 'class': 'td right' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'style': 'margin-right:5px;',
						'click': ui.createHandlerFn(this, function() {
							if (confirm(_('Restore backup from %s? Your current settings will be backed up automatically.').format(bk.date))) {
								callMieruRestoreBackup(bk.timestamp).then(res => {
									if (res.success) {
										ui.addNotification(null, E('p', _('Configuration restored successfully.')), 'ok');
										// Reload page to apply
										setTimeout(() => location.reload(), 1500);
									} else {
										ui.addNotification(null, E('p', _('Restore failed: ') + res.error));
									}
								});
							}
						})
					}, _('Restore')),
					E('button', {
						'class': 'btn cbi-button-reset',
						'click': ui.createHandlerFn(this, function() {
							if (confirm(_('Delete backup from %s?').format(bk.date))) {
								callMieruDeleteBackup(bk.timestamp).then(res => {
									if (res.success) {
										ui.addNotification(null, E('p', _('Backup deleted.')), 'ok');
										callMieruGetBackups().then(res2 => this.renderBackupsList(res2.backups));
									}
								});
							}
						})
					}, _('Delete'))
				])
			]));
		});
	},

	showImportPreview: function(preview, confirmFn) {
		const fieldNames = {
			enabled: _('Enable'),
			server: _('Server'),
			port: _('Port'),
			username: _('Username'),
			password: _('Password'),
			protocol: _('Transport'),
			socks5_port: _('SOCKS5 Port'),
			mtu: _('MTU')
		};

		const rows = [];
		for (let key in preview) {
			const item = preview[key];
			if (item.old !== item.new) {
				const displayName = fieldNames[key] || key;
				rows.push(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td left', 'style': 'font-weight:bold;' }, displayName),
					E('td', { 'class': 'td left' }, item.old || '-'),
					E('td', { 'class': 'td left', 'style': 'color:#5cb85c; font-weight:bold;' }, item.new || '-')
				]));
			}
		}

		if (rows.length === 0) {
			ui.showModal(_('Import Configuration'), [
				E('p', {}, _('No configuration changes detected.')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close'))
				])
			]);
			return;
		}

		const table = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th left' }, _('Parameter')),
				E('th', { 'class': 'th left' }, _('Current Value')),
				E('th', { 'class': 'th left' }, _('New Value'))
			]),
			...rows
		]);

		const checkAutoBk = E('input', { 'type': 'checkbox', 'id': 'import_auto_bk', 'checked': true });

		ui.showModal(_('Configuration Changes Preview'), [
			E('p', {}, _('Please review the imported configuration changes before confirming:')),
			table,
			E('div', { 'style': 'margin-top:15px;' }, [
				E('label', {}, [
					checkAutoBk, ' ', _('Create backup of current settings before importing')
				])
			]),
			E('div', { 'class': 'right', 'style': 'margin-top:15px;' }, [
				E('button', { 'class': 'btn cbi-button-reset', 'click': ui.hideModal, 'style': 'margin-right:5px;' }, _('Cancel')),
				E('button', {
					'class': 'btn cbi-button-action',
					'click': function() {
						ui.hideModal();
						confirmFn(checkAutoBk.checked);
					}
				}, _('Confirm & Apply'))
			])
		]);
	},

	render: function(loadedData) {
		const uciData = loadedData[0];
		const backupsData = loadedData[1]?.backups || [];

		const m = new form.Map('mieru', '', '');

		const s = m.section(form.NamedSection, 'main', 'mieru');
		s.anonymous = true;

		// Tab structure
		s.tab('general', _('General Settings'));
		s.tab('diagnostics', _('Diagnostics'));
		s.tab('logs', _('Logs'));
		s.tab('json', _('Configuration JSON'));
		s.tab('backup', _('Backup & Restore'));

		// ------------------ General settings ------------------
		let o;

		// Quick URL Import Box at top of General Settings
		o = s.taboption('general', form.DummyValue, '_quick_url');
		o.rawhtml = true;
		o.render = L.bind(function() {
			const urlInput = E('input', {
				'type': 'text',
				'id': 'mieru_quick_url_input',
				'class': 'cbi-input-text',
				'style': 'width: calc(100% - 170px); margin-right: 8px; font-family: monospace;',
				'placeholder': _('Paste Mieru URL (mierus://...) here...')
			});

			const applyBtn = E('button', {
				'class': 'btn cbi-button-action',
				'style': 'white-space: nowrap;',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();
					const urlVal = urlInput.value.trim();
					if (!urlVal) {
						ui.addNotification(null, E('p', _('Please enter a Mieru URL first!')));
						return;
					}
					const parsed = parseMieruUrl(urlVal);
					if (parsed) {
						applyParsedConfigToForm(parsed);
						urlInput.value = '';
						ui.addNotification(null, E('p', _('✓ Ссылка распарсена! Все поля формы автоматически заполнены. Нажмите "Сохранить и применить" внизу для сохранения.')), 'ok');
					} else {
						ui.addNotification(null, E('p', _('Не удалось распознать формат ссылки Mieru.')), 'error');
					}
				})
			}, _('Import URL'));

			return E('div', { 'class': 'cbi-value', 'style': 'background: rgba(0, 128, 255, 0.05); padding: 12px; border-radius: 6px; border: 1px solid rgba(0, 128, 255, 0.2); margin-bottom: 15px;' }, [
				E('label', { 'class': 'cbi-value-title', 'style': 'font-weight: bold; color: #0072c6;' }, _('Import from Link:')),
				E('div', { 'class': 'cbi-value-field', 'style': 'display: flex; align-items: center;' }, [
					urlInput,
					applyBtn
				])
			]);
		}, this);

		o = s.taboption('general', form.Flag, 'enabled', _('Enable'), _('Enable Mieru client service'));
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'server', _('Server'), _('Mieru server IP address or hostname'));
		o.datatype = 'host';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'port', _('Port'), _('Mieru server port or port range (e.g. 2012 or 2012-2022)'));
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'username', _('Username'), _('Proxy connection username'));
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'password', _('Password'), _('Proxy connection password'));
		o.password = true;
		o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'protocol', _('Transport'), _('Underlay network protocol'));
		o.value('TCP', 'TCP');
		o.value('UDP', 'UDP');
		o.default = 'TCP';

		o = s.taboption('general', form.Value, 'socks5_port', _('SOCKS5 Port'), _('Local SOCKS5 proxy port'));
		o.datatype = 'port';
		o.default = '1080';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'mtu', _('MTU'), _('Maximum Transmission Unit (1280-1400)'));
		o.datatype = 'range(1280, 1400)';
		o.default = '1400';
		o.placeholder = '1400';

		o = s.taboption('general', form.ListValue, 'log_level', _('Log Level'), _('Logging verbosity'));
		o.value('DEBUG', 'DEBUG');
		o.value('INFO', 'INFO');
		o.value('WARNING', 'WARNING');
		o.value('ERROR', 'ERROR');
		o.value('FATAL', 'FATAL');
		o.default = 'ERROR';

		// Monitor settings
		o = s.taboption('general', form.ListValue, 'monitor_interval', _('Monitor Interval'), _('Background connection monitoring update interval'));
		o.value('0', _('Disabled'));
		o.value('30', _('30 sec'));
		o.value('10', _('10 sec'));
		o.value('5', _('5 sec'));
		o.value('3', _('3 sec'));
		o.default = '10';

		o = s.taboption('general', form.Flag, 'auto_backup', _('Auto Backup'), _('Automatically create backups before saving/applying'));
		o.default = '1';

		o = s.taboption('general', form.ListValue, 'auto_backup_limit', _('Backup Limit'), _('Maximum number of rolling automatic backups to keep'));
		o.value('1', '1');
		o.value('3', '3');
		o.value('5', '5');
		o.value('10', '10');
		o.default = '5';

		// ------------------ Diagnostics ------------------
		o = s.taboption('diagnostics', form.DummyValue, '_diagnose');
		o.rawhtml = true;
		o.render = L.bind(function() {
			const consoleBox = E('pre', {
				'id': 'diag_console',
				'style': 'width:100%; height:200px; background-color:rgba(0,0,0,0.05); border:1px solid rgba(128,128,128,0.2); padding:10px; border-radius:4px; font-family:monospace; overflow-y:auto; margin-bottom:10px; color:inherit;'
			}, _('Select diagnostic tool above to start test...\n'));

			const logMsg = function(msg) {
				consoleBox.innerText += msg + '\n';
				consoleBox.scrollTop = consoleBox.scrollHeight;
			};

			const clearConsole = function() {
				consoleBox.innerText = '';
			};

			return E('div', {}, [
				E('div', { 'class': 'cbi-value', 'style': 'padding-left:0; border:none;' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'style': 'margin-right: 5px;',
						'click': ui.createHandlerFn(this, function() {
							const srv = uci.get('mieru', 'main', 'server');
							if (!srv) {
								ui.addNotification(null, E('p', _('Please configure server IP first!')));
								return;
							}
							clearConsole();
							logMsg(`PING ${srv}...`);
							callMieruPing(srv).then(res => {
								const out = res.output || '';
								logMsg(out);
								if (out.indexOf('100% packet loss') !== -1 || out.indexOf('0 packets received') !== -1 || !out) {
									logMsg(_('ICMP Ping failed (ICMP запрещён на сервере)'));
								} else {
									logMsg(_('ICMP Ping successful'));
								}
							});
						})
					}, _('Ping Server')),

					E('button', {
						'class': 'btn cbi-button-action',
						'style': 'margin-right: 5px;',
						'click': ui.createHandlerFn(this, function() {
							const srv = uci.get('mieru', 'main', 'server');
							let port = uci.get('mieru', 'main', 'port');
							if (!srv || !port) {
								ui.addNotification(null, E('p', _('Please configure server and port first!')));
								return;
							}
							if (index(port, '-') !== -1) {
								port = split(port, '-')[0];
							}
							clearConsole();
							logMsg(`TCP Connect ${srv}:${port}...`);
							callMieruTcpConnect(srv, port).then(res => {
								if (res.success) {
									logMsg(`✓ ` + _('TCP соединение установлено'));
									logMsg(`TCP RTT: ${res.rtt} ` + _('ms'));
									
									logMsg(_('Проверка ICMP Ping...'));
									callMieruPing(srv).then(pingRes => {
										const pingOut = pingRes.output || '';
										if (pingOut.indexOf('100% packet loss') !== -1 || pingOut.indexOf('0 packets received') !== -1 || !pingOut) {
											logMsg(_('ICMP отключён на сервере'));
											logMsg(_('TCP работает нормально'));
										} else {
											logMsg(_('ICMP Ping также работает'));
										}
									});
								} else {
									logMsg(`✗ ` + _('TCP соединение невозможно') + ` (${res.error || _('Timeout')})`);
								}
							});
						})
					}, _('TCP Connect')),

					E('button', {
						'class': 'btn cbi-button-action',
						'style': 'margin-right: 5px;',
						'click': ui.createHandlerFn(this, function() {
							clearConsole();
							logMsg('Validating generated config /var/etc/mieru_client_config.json...');
							callMieruValidate().then(res => {
								if (res.valid) {
									logMsg(_('Configuration is valid!') + '\n' + JSON.stringify(res.config, null, 2));
								} else {
									logMsg(_('Error: ') + res.error);
								}
							});
						})
					}, _('Validate Config')),

					E('button', {
						'id': 'mieru_btn_testsocks',
						'class': 'btn cbi-button-action',
						'style': 'margin-right: 5px;',
						'click': ui.createHandlerFn(this, function() {
							const p = uci.get('mieru', 'main', 'socks5_port') || '1080';
							clearConsole();
							logMsg(`Testing local SOCKS5 proxy on port ${p}...`);
							callMieruTestSocks(p).then(res => {
								logMsg(res.output || _('No response'));
								logMsg(res.success ? _('SOCKS5 proxy test successful!') : _('SOCKS5 proxy test failed.'));
							});
						})
					}, _('Test SOCKS5')),
				]),
				consoleBox
			]);
		}, this);

		// ------------------ Logs ------------------
		o = s.taboption('logs', form.DummyValue, '_logs');
		o.rawhtml = true;
		o.render = L.bind(function() {
			const logArea = E('textarea', {
				'id': 'syslog_box',
				'readonly': true,
				'style': 'width:100%; height:300px; font-family:monospace; background-color:rgba(0,0,0,0.02); border:1px solid rgba(128,128,128,0.2); padding:10px; border-radius:4px; margin-bottom:10px; color:inherit;'
			}, _('Loading logs...'));

			const chkAutoscroll = E('input', { 'type': 'checkbox', 'id': 'mieru_log_autoscroll', 'checked': true });

			const refreshLogs = function() {
				// Only fetch logs if the log area is currently visible (Logs tab is active)
				if (logArea.offsetWidth > 0 && logArea.offsetHeight > 0) {
					callMieruReadLog().then(res => {
						logArea.value = res.log || _('No log entries found.');
						if (chkAutoscroll.checked) {
							logArea.scrollTop = logArea.scrollHeight;
						}
					});
				}
			};

			// Setup periodic refresh
			poll.add(refreshLogs, 10);
			setTimeout(refreshLogs, 200);

			return E('div', {}, [
				logArea,
				E('div', { 'style': 'display:flex; align-items:center; justify-content:space-between;' }, [
					E('div', {}, [
						E('button', {
							'class': 'btn cbi-button-neutral',
							'style': 'margin-right: 5px;',
							'click': refreshLogs
						}, _('Refresh')),
						E('button', {
							'class': 'btn cbi-button-reset',
							'style': 'margin-right: 5px;',
							'click': ui.createHandlerFn(this, function() {
								if (confirm(_('Clear entire system logs?'))) {
									callMieruClearLog().then(res => {
										if (res.success) {
											logArea.value = '';
											refreshLogs();
											ui.addNotification(null, E('p', _('System logs cleared.')));
										}
									});
								}
							})
						}, _('Clear Log')),
						E('button', {
							'class': 'btn cbi-button-save',
							'click': function() {
								const blob = new Blob([logArea.value], { type: 'text/plain' });
								const link = E('a', {
									'href': URL.createObjectURL(blob),
									'download': 'mieru_syslog.txt'
								});
								document.body.appendChild(link);
								link.click();
								document.body.removeChild(link);
							}
						}, _('Download Log'))
					]),
					E('label', { 'style': 'font-size:12px; opacity:0.7;' }, [
						chkAutoscroll, ' ', _('Auto-scroll')
					])
				])
			]);
		}, this);

		// ------------------ JSON View ------------------
		o = s.taboption('json', form.DummyValue, '_json');
		o.rawhtml = true;
		o.render = L.bind(function() {
			const jsonBox = E('pre', {
				'id': 'json_viewer_box',
				'style': 'width:100%; height:300px; background-color:rgba(0,0,0,0.02); border:1px solid rgba(128,128,128,0.2); padding:10px; border-radius:4px; font-family:monospace; overflow-y:auto; margin-bottom:10px; color:inherit;'
			}, _('Loading JSON config...'));

			const refreshJson = function() {
				callMieruValidate().then(res => {
					if (res.valid) {
						jsonBox.innerText = JSON.stringify(res.config, null, 4);
					} else {
						jsonBox.innerText = _('No active JSON configuration found. Start the service to generate configuration.');
					}
				});
			};

			setTimeout(refreshJson, 200);

			return E('div', {}, [
				jsonBox,
				E('button', {
					'class': 'btn cbi-button-action',
					'click': function() {
						navigator.clipboard.writeText(jsonBox.innerText);
						ui.addNotification(null, E('p', _('JSON copied to clipboard!')));
					}
				}, _('Copy to Clipboard'))
			]);
		}, this);

		// ------------------ Backup & Restore Tab ------------------
		o = s.taboption('backup', form.DummyValue, '_backup_tab');
		o.rawhtml = true;
		o.render = L.bind(function() {
			// Manual Backup Form
			const inputComment = E('input', {
				'type': 'text',
				'placeholder': _('Backup comment (e.g. Before manual change)'),
				'style': 'width: 300px; margin-right: 5px;'
			});

			const fileInput = E('input', {
				'type': 'file',
				'id': 'mieru_upload_file',
				'style': 'display:none;',
				'change': ui.createHandlerFn(this, function(ev) {
					const file = ev.target.files[0];
					if (!file) return;

					const reader = new FileReader();
					reader.onload = function(e) {
						const contents = e.target.result;
						
						if (file.name.endsWith('.json')) {
							// Parse JSON
							callMieruImportJson(contents).then(res => {
								if (res.error) {
									ui.addNotification(null, E('p', _('Import failed: ') + res.error));
									return;
								}
								this.showImportPreview(res.preview, function(autoBk) {
									callMieruConfirmImportJson(autoBk).then(confirmRes => {
										if (confirmRes.success) {
											ui.addNotification(null, E('p', _('Configuration imported successfully.')), 'ok');
											setTimeout(() => location.reload(), 1500);
										}
									});
								});
							});
						} else {
							// Binary backup (.tar.gz)
							const base64Data = window.btoa(
								new Uint8Array(contents)
									.reduce((data, byte) => data + String.fromCharCode(byte), '')
							);
							callMieruImportBackup(base64Data, _('User uploaded archive')).then(res => {
								if (res.error) {
									ui.addNotification(null, E('p', _('Import failed: ') + res.error));
									return;
								}
								this.showImportPreview(res.preview, function(autoBk) {
									callMieruConfirmRestore(autoBk).then(confirmRes => {
										if (confirmRes.success) {
											ui.addNotification(null, E('p', _('Backup restored successfully.')), 'ok');
											setTimeout(() => location.reload(), 1500);
										}
									});
								});
							});
						}
					}.bind(this);

					if (file.name.endsWith('.json')) {
						reader.readAsText(file);
					} else {
						reader.readAsArrayBuffer(file);
					}
				})
			});

			const backupsTable = E('table', { 'class': 'table cbi-section-table' }, [
				E('tr', { 'class': 'tr' }, [
					E('th', { 'class': 'th left' }, _('Date')),
					E('th', { 'class': 'th left' }, _('Size')),
					E('th', { 'class': 'th left' }, _('Mieru Version')),
					E('th', { 'class': 'th left' }, _('Package Version')),
					E('th', { 'class': 'th left' }, _('OpenWrt Version')),
					E('th', { 'class': 'th left' }, _('Device Name')),
					E('th', { 'class': 'th left' }, _('Comment')),
					E('th', { 'class': 'th right' }, _('Actions'))
				]),
				E('tbody', { 'id': 'mieru_backups_tbody' })
			]);

			// Load backups list on display
			setTimeout(() => this.renderBackupsList(backupsData), 100);

			return E('div', {}, [
				E('h3', {}, _('Backup Settings')),
				E('div', { 'class': 'cbi-value', 'style': 'border:none; padding-left:0;' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'style': 'margin-right:5px;',
						'click': function() {
							// Download raw UCI
							fs.readfile('/etc/config/mieru').then(content => {
								const blob = new Blob([content], { type: 'text/plain' });
								const link = E('a', { 'href': URL.createObjectURL(blob), 'download': 'mieru.uci' });
								document.body.appendChild(link);
								link.click();
								document.body.removeChild(link);
							});
						}
					}, _('Export UCI Settings')),
					
					E('button', {
						'class': 'btn cbi-button-action',
						'style': 'margin-right:5px;',
						'click': function() {
							// Download JSON config
							fs.readfile('/var/etc/mieru_client_config.json').then(content => {
								const blob = new Blob([content], { type: 'application/json' });
								const link = E('a', { 'href': URL.createObjectURL(blob), 'download': 'mieru_client_config.json' });
								document.body.appendChild(link);
								link.click();
								document.body.removeChild(link);
							}).catch(() => {
								ui.addNotification(null, E('p', _('No active JSON configuration found.')));
							});
						}
					}, _('Export JSON Configuration')),
					
					E('button', {
						'class': 'btn cbi-button-action',
						'style': 'margin-right:5px;',
						'click': function() {
							// Export full archive tar.gz
							callMieruExportBackup().then(res => {
								if (res.error) {
									ui.addNotification(null, E('p', _('Backup failed: ') + res.error));
									return;
								}
								const ab = base64ToArrayBuffer(res.data);
								const blob = new Blob([ab], { type: 'application/gzip' });
								const link = E('a', { 'href': URL.createObjectURL(blob), 'download': `mieru_backup_${Math.floor(Date.now()/1000)}.tar.gz` });
								document.body.appendChild(link);
								link.click();
								document.body.removeChild(link);
							});
						}
					}, _('Export Full Backup Archive')),

					E('button', {
						'class': 'btn cbi-button-neutral',
						'click': function() {
							// Paste JSON manually
							const ta = E('textarea', { 'style': 'width:100%; height:150px; font-family:monospace;', 'placeholder': _('Paste Mieru SOCKS5, Sing-Box JSON, or Mieru URL (mierus://...) configuration here...') });
							const checkAutoBk = E('input', { 'type': 'checkbox', 'id': 'manual_import_auto_bk', 'checked': true });
							
							ui.showModal(_('Import JSON or URL Configuration'), [
								ta,
								E('div', { 'style': 'margin-top:10px;' }, [
									E('label', {}, [
										checkAutoBk, ' ', _('Create backup of current settings before importing')
									])
								]),
								E('div', { 'class': 'right', 'style': 'margin-top:10px;' }, [
									E('button', { 'class': 'btn cbi-button-reset', 'click': ui.hideModal, 'style': 'margin-right:5px;' }, _('Cancel')),
									E('button', {
										'class': 'btn cbi-button-action',
										'click': function() {
											const contents = ta.value;
											if (!contents) return;
											ui.hideModal();
											
											callMieruImportJson(contents).then(res => {
												if (res.error) {
													ui.addNotification(null, E('p', _('Import failed: ') + res.error));
													return;
												}
												this.showImportPreview(res.preview, function(autoBk) {
													callMieruConfirmImportJson(autoBk).then(confirmRes => {
														if (confirmRes.success) {
															ui.addNotification(null, E('p', _('Configuration imported successfully.')), 'ok');
															setTimeout(() => location.reload(), 1500);
														}
													});
												});
											});
										}.bind(this)
									}, _('Validate & Preview'))
								])
							]);
						}.bind(this)
					}, _('Paste JSON'))
				]),

				// Restore Actions
				E('div', { 'class': 'cbi-value', 'style': 'border:none; padding-left:0; border-top: 1px solid rgba(128,128,128,0.1); padding-top:15px;' }, [
					fileInput,
					E('button', {
						'class': 'btn cbi-button-neutral',
						'style': 'margin-right:5px;',
						'click': function() {
							fileInput.click();
						}
					}, _('Upload Backup File')),
					
					E('button', {
						'class': 'btn cbi-button-reset',
						'click': ui.createHandlerFn(this, function() {
							if (confirm(_('Reset Mieru client settings to default? Current configuration will be lost!'))) {
								callMieruResetConfig().then(res => {
									if (res.success) {
										ui.addNotification(null, E('p', _('Configuration reset successfully.')), 'ok');
										setTimeout(() => location.reload(), 1500);
									}
								});
							}
						})
					}, _('Reset Settings'))
				]),

				// Manual Backup Creation
				E('div', { 'class': 'cbi-value', 'style': 'border:none; padding-left:0; border-top: 1px solid rgba(128,128,128,0.1); padding-top:15px; margin-bottom: 25px;' }, [
					E('div', { 'style': 'display:flex; align-items:center;' }, [
						inputComment,
						E('button', {
							'class': 'btn cbi-button-save',
							'click': ui.createHandlerFn(this, function() {
								const comment = inputComment.value;
								callMieruCreateManualBackup(comment).then(res => {
									if (res.success) {
										ui.addNotification(null, E('p', _('Manual backup created.')), 'ok');
										inputComment.value = '';
										callMieruGetBackups().then(res2 => this.renderBackupsList(res2.backups));
									}
								});
							})
						}, _('Create Manual Backup'))
					])
				]),

				E('h3', {}, _('Saved Backups')),
				backupsTable
			]);
		}, this);

		// ------------------ Map render overlay ------------------
		return L.resolveDefault(m.render()).then(L.bind(function(map_rendered) {
			const svgLogo = `<svg class="mieru-logo" viewBox="0 0 24 24" width="48" height="48" style="vertical-align: middle; margin-right: 12px;">
				<defs>
					<linearGradient id="mieruGrad" x1="0%" y1="0%" x2="100%" y2="100%">
						<stop offset="0%" style="stop-color:#00f2fe;stop-opacity:1" />
						<stop offset="100%" style="stop-color:#4facfe;stop-opacity:1" />
					</linearGradient>
				</defs>
				<path fill="url(#mieruGrad)" d="M12,4.5C7,4.5,2.73,7.61,1,12c1.73,4.39,6,7.5,11,7.5s9.27-3.11,11-7.5C21.27,7.61,17,4.5,12,4.5z M12,17c-2.76,0-5-2.24-5-5s2.24-5,5-5s5,2.24,5,5S14.76,17,12,17z M12,9c-1.66,0-3,1.34-3,3s1.34,3,3,3s3-1.34,3-3S13.66,9,12,9z"/>
			</svg>`;

			const statusCard = E('fieldset', { 'class': 'cbi-section' }, [
				E('legend', {}, _('Status')),
				E('table', { 'class': 'table cbi-section-table', 'style': 'margin-bottom:15px;' }, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:50%; border:none; padding:10px; vertical-align:top;' }, [
							E('div', { 'class': 'cbi-value', 'style': 'border:none; padding:15px; background-color:rgba(0,0,0,0.02); border-radius:8px; text-align:center; display:flex; flex-direction:column; justify-content:center; height:100px; box-sizing:border-box;' }, [
								E('div', { 'style': 'font-size:12px; opacity:0.6; margin-bottom:5px;' }, _('Server Connection')),
								E('div', { 'id': 'mieru_status_text', 'style': 'font-size:22px; font-weight:bold; color:#d9534f;' }, _('Offline')),
								E('div', { 'id': 'mieru_latency_text', 'style': 'font-size:14px; font-weight:bold; color:#00f2fe; margin-top:2px;' }, '-')
							])
						]),
						E('td', { 'class': 'td', 'style': 'border:none; padding:10px; vertical-align:top;' }, [
							E('div', { 'class': 'cbi-value', 'style': 'border:none; padding:10px; background-color:rgba(0,0,0,0.02); border-radius:8px; height:100px; display:flex; flex-direction:column; box-sizing:border-box;' }, [
								E('div', { 'style': 'font-size:12px; opacity:0.6; margin-bottom:5px;' }, _('Latency History (1 Hour)')),
								E('canvas', { 'id': 'mieru_history_canvas', 'width': '500', 'height': '55', 'style': 'width:100%; height:55px; display:block;' })
							])
						])
					])
				]),
				
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'table', 'style': 'margin-bottom:15px;' }, [
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Service State:')),
							E('div', { 'class': 'td', 'id': 'mieru_service_status', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-'),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Connection Uptime:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_conn_uptime', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-')
						]),
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Process PID:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_pid', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-'),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Reconnections:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_reconns', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-')
						]),
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Process Memory:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_mem', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-'),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Last Reconnect:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_last_success', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-')
						]),
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Process Uptime:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_uptime', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-'),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Local SOCKS5 proxy:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_socks', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-')
						]),
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Connected Server:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_server', 'style': 'width:75%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);', 'colspan': 3 }, '-'),
						]),
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Last Client Error:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_last_error', 'style': 'width:75%; padding:8px; font-family:monospace; font-size:11px; border-bottom:1px solid rgba(128,128,128,0.1);', 'colspan': 3 }, '-')
						]),

						// Detailed Performance Stats
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('RTT Latency (Min/Max/Avg):')),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, [
								E('span', { 'id': 'mieru_val_lat_min' }, '-'), ' / ',
								E('span', { 'id': 'mieru_val_lat_max' }, '-'), ' / ',
								E('span', { 'id': 'mieru_val_lat_avg' }, '-')
							]),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Active Connections:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_act_conns', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, '-')
						]),
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Total Traffic:')),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, [
								E('span', { 'id': 'mieru_val_traffic_total' }, '-')
							]),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Current Speed (RX/TX):')),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);' }, [
								E('span', { 'id': 'mieru_val_speed_rx' }, '-'), ' / ',
								E('span', { 'id': 'mieru_val_speed_tx' }, '-')
							])
						]),
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; border-bottom:1px solid rgba(128,128,128,0.1);' }, _('Average Speed (RX/TX):')),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; border-bottom:1px solid rgba(128,128,128,0.1);', 'colspan': 3 }, [
								E('span', { 'id': 'mieru_val_speed_avg_rx' }, '-'), ' / ',
								E('span', { 'id': 'mieru_val_speed_avg_tx' }, '-')
							])
						]),

						// Self-monitoring stats
						E('div', { 'class': 'tr' }, [
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; opacity:0.7;' }, _('Monitor CPU / RAM:')),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; opacity:0.7;' }, [
								E('span', { 'id': 'mieru_val_cpu_m' }, '-'), ' / ',
								E('span', { 'id': 'mieru_val_mem_m' }, '-')
							]),
							E('div', { 'class': 'td', 'style': 'width:25%; padding:8px; font-weight:bold; opacity:0.7;' }, _('Shell commands count:')),
							E('div', { 'class': 'td', 'id': 'mieru_val_shell_m', 'style': 'width:25%; padding:8px; opacity:0.7;' }, '-')
						])
					])
				]),
				
				E('div', { 'class': 'cbi-value', 'style': 'border:none; padding-left:0; margin-top:10px; display:flex; align-items:center; justify-content:space-between;' }, [
					E('div', {}, [
						E('button', {
							'id': 'mieru_btn_start',
							'class': 'btn cbi-button-action',
							'style': 'margin-right: 5px;',
							'click': ui.createHandlerFn(this, function() {
								return callInitAction({ name: 'mieru', action: 'start' }).then(() => {
									ui.addNotification(null, E('p', _('Mieru Client started.')));
								});
							})
						}, _('Start Mieru')),
						E('button', {
							'id': 'mieru_btn_stop',
							'class': 'btn cbi-button-reset',
							'style': 'margin-right: 5px;',
							'click': ui.createHandlerFn(this, function() {
								return callInitAction({ name: 'mieru', action: 'stop' }).then(() => {
									ui.addNotification(null, E('p', _('Mieru Client stopped.')));
								});
							})
						}, _('Stop Mieru')),
						E('button', {
							'id': 'mieru_btn_restart',
							'class': 'btn cbi-button-save',
							'style': 'margin-right: 15px;',
							'click': ui.createHandlerFn(this, function() {
								return callInitAction({ name: 'mieru', action: 'restart' }).then(() => {
									ui.addNotification(null, E('p', _('Mieru Client restarted.')));
								});
							})
						}, _('Restart Mieru')),

						// Copy SOCKS5 URL Buttons
						E('button', {
							'class': 'btn cbi-button-neutral',
							'style': 'margin-right: 5px;',
							'click': function() {
								const port = uci.get('mieru', 'main', 'socks5_port') || '1080';
								const ip = window.location.hostname || '192.168.1.1';
								const url = `socks5://${ip}:${port}`;
								copyTextToClipboard(url).then(
									() => ui.addNotification(null, E('p', _('SOCKS5 URL успешно скопирован')), 'ok'),
									() => ui.addNotification(null, E('p', _('Ошибка копирования SOCKS5 URL')), 'error')
								);
							}
						}, _('Copy SOCKS5 URL')),
						E('button', {
							'class': 'btn cbi-button-neutral',
							'click': function() {
								const port = uci.get('mieru', 'main', 'socks5_port') || '1080';
								const ip = window.location.hostname || '192.168.1.1';
								const url = `socks5h://${ip}:${port}`;
								copyTextToClipboard(url).then(
									() => ui.addNotification(null, E('p', _('SOCKS5h URL успешно скопирован')), 'ok'),
									() => ui.addNotification(null, E('p', _('Ошибка копирования SOCKS5h URL')), 'error')
								);
							}
						}, _('Copy SOCKS5h URL')),
						E('button', {
							'class': 'btn cbi-button-action',
							'style': 'margin-left: 10px;',
							'click': ui.createHandlerFn(this, function() {
								const ta = E('textarea', { 'style': 'width:100%; height:150px; font-family:monospace;', 'placeholder': _('Paste Mieru URL (mierus://...) or JSON configuration here...') });
								const checkAutoBk = E('input', { 'type': 'checkbox', 'id': 'quick_modal_import_auto_bk', 'checked': true });
								
								ui.showModal(_('Import Configuration via Link / JSON'), [
									ta,
									E('div', { 'style': 'margin-top:10px;' }, [
										E('label', {}, [
											checkAutoBk, ' ', _('Create backup of current settings before importing')
										])
									]),
									E('div', { 'class': 'right', 'style': 'margin-top:10px;' }, [
										E('button', { 'class': 'btn cbi-button-reset', 'click': ui.hideModal, 'style': 'margin-right:5px;' }, _('Cancel')),
										E('button', {
											'class': 'btn cbi-button-action',
											'click': ui.createHandlerFn(this, function() {
												const contents = ta.value.trim();
												if (!contents) {
													ui.addNotification(null, E('p', _('Please enter a Mieru URL or JSON first!')));
													return;
												}
												ui.hideModal();
												const parsed = parseMieruUrl(contents);
												if (parsed) {
													applyParsedConfigToForm(parsed);
													ui.addNotification(null, E('p', _('✓ Ссылка распарсена! Все поля формы автоматически заполнены. Нажмите "Сохранить и применить" внизу для сохранения.')), 'ok');
													return;
												}
												callMieruImportJson(contents).then(res => {
													if (res.error) {
														ui.addNotification(null, E('p', _('Import failed: ') + res.error));
														return;
													}
													this.showImportPreview(res.preview, function(autoBk) {
														callMieruConfirmImportJson(autoBk).then(confirmRes => {
															if (confirmRes.success) {
																ui.addNotification(null, E('p', _('Configuration imported successfully.')), 'ok');
																setTimeout(() => location.reload(), 1500);
															}
														});
													});
												});
											})
										}, _('Import & Apply'))
									])
								]);
							})
						}, _('Import Link / JSON'))
					]),
					E('div', { 'style': 'font-size:12px; opacity:0.5;' }, [
						_('Last Update:'), ' ', E('span', { 'id': 'mieru_val_last_update' }, _('Never'))
					])
				])
			]);

			// Poll handler
			const pollFn = L.bind(function() {
				return callMieruStatus().then(L.bind(this.updateStatus, this));
			}, this);

			poll.add(pollFn, this.pollInterval);
			poll.start();

			// Initial run
			setTimeout(pollFn, 200);

			return E('div', {}, [
				E('div', { 'style': 'display:flex; align-items:center; margin-bottom: 20px;' }, [
					E('div', { 'raw': svgLogo }),
					E('div', {}, [
						E('h2', { 'style': 'margin:0;' }, _('Mieru Client')),
						E('p', { 'style': 'margin:0; opacity:0.6;' }, _('Secure and fast proxy client utilizing Mieru protocol.'))
					])
				]),
				statusCard,
				map_rendered
			]);
		}, this));
	},

	handleSaveApply: function(ev, mode) {
		const autoBk = uci.get('mieru', 'main', 'auto_backup') === '1';
		return this.handleSave(ev).then(L.bind(function() {
			ui.addNotification(null, E('p', _('Applying configuration changes...')), 'info');
			
			let p = Promise.resolve();
			if (autoBk) {
				p = callMieruCreateManualBackup(_('Automatic backup before settings save'));
			}
			
			return p.then(() => {
				return callInitAction({ name: 'mieru', action: 'restart' }).then(function() {
					ui.addNotification(null, E('p', _('Configuration successfully applied.')), 'ok');
					// Refresh backups list if backup tab is active
					const tbody = document.getElementById('mieru_backups_tbody');
					if (tbody) {
						callMieruGetBackups().then(res => this.renderBackupsList(res.backups));
					}
				}.bind(this));
			});
		}, this));
	}
});
