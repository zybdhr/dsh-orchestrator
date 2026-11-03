window.__ModuleLoader__.load({id: 'dsh-local-orchestrator', factory: require => {
  const React = require('react');
  const h = React.createElement;
  const {useState, useEffect} = React;
  const labels = {draft: '待执行', pending: '等待依赖', running: '执行中', reviewing: '独立审核中', completed: '已通过', failed: '失败', interrupted: '已中断', paused: '已暂停', blocked: '需要处理', cancelled: '已取消'};
  const css = `.dsho{max-width:1100px;width:100%;flex:1;min-height:0;overflow-y:auto;box-sizing:border-box;margin:0 auto;padding:24px;color:var(--dsw-alias-label-primary,inherit);font:inherit}.dsho-shell{display:flex;flex-direction:column;flex:1;min-height:0;height:100%;width:100%;overflow:hidden}.dsho-tabs{display:flex;flex:none;gap:8px;padding:12px 24px;border-bottom:1px solid #8883}.dsho-tabs button{font:inherit;color:inherit;border:1px solid #8885;border-radius:8px;background:transparent;padding:7px 12px;cursor:pointer}.dsho-tabs button[aria-selected=true]{background:#657de018;border-color:#657de0}.dsho-content{display:flex;flex:1;min-height:0;overflow:hidden}.dsho h2{font-size:22px;margin:0 0 12px}.dsho p{line-height:1.7;opacity:.8}.dsho button,.dsho select,.dsho input,.dsho textarea{font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform,transparent);border:1px solid #8886;border-radius:8px;padding:7px 10px}.dsho button{cursor:pointer}.dsho button:disabled{cursor:default;opacity:.4}.dsho .dsho-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.dsho .dsho-card{border:1px solid #8885;border-radius:12px;margin:14px 0;padding:16px}.dsho summary{cursor:pointer;line-height:1.8}.dsho .dsho-title{font-weight:600}.dsho .dsho-muted{opacity:.65;font-size:12px;overflow-wrap:anywhere}.dsho table{border-collapse:collapse;width:100%;font-size:13px}.dsho th,.dsho td{text-align:left;padding:9px 6px;border-bottom:1px solid #8883;vertical-align:top}.dsho .dsho-table{overflow:auto}.dsho pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;font:inherit;font-size:12px;line-height:1.6}.dsho .dsho-error{color:#df6549}.dsho .dsho-completed{color:#26916b}.dsho .dsho-running,.dsho .dsho-reviewing{color:#657de0}.dsho .dsho-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}.dsho label{display:grid;gap:6px;font-size:13px}.dsho textarea{min-height:90px;width:100%;box-sizing:border-box}.dsho .dsho-chip{display:inline-block;border:1px solid #8884;border-radius:6px;padding:2px 6px;font-size:12px}.dsho .dsho-notice{border-left:3px solid #657de0;padding-left:12px}.dsho .dsho-model-row{border:1px solid #8883;border-radius:10px;padding:12px;margin:10px 0}.dsho .dsho-model-row-head{display:flex;align-items:center;gap:8px;min-width:0;margin-bottom:8px}.dsho .dsho-model-alias{font-weight:600;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsho .dsho-model-fields{display:grid;grid-template-columns:minmax(170px,1.2fr) minmax(170px,1fr) minmax(130px,.7fr);gap:10px;align-items:end}.dsho .dsho-model-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.dsho .dsho-model-actions button{font-size:12px;padding:4px 8px}@media(max-width:720px){.dsho .dsho-model-fields{grid-template-columns:1fr}}`;
  const settingsLayoutCss = `
    [role="dialog"]:has(.dsho-shell){width:min(1280px,calc(100vw - 48px));height:min(900px,calc(100dvh - 64px))}
    .dsho-shell{--dsho-surface:var(--dsw-alias-bg-layer-1,#fff);font:14px/1.6 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#293244)}
    .dsho,.dsho *{box-sizing:border-box}.dsho{padding:28px 28px 48px;max-width:1040px;container-type:inline-size;container-name:dsho-panel}
    .dsho input,.dsho select,.dsho textarea,.dsho button{background:var(--dsho-surface)}.dsho button{font-size:12px}
    .dsho h2{font-size:20px;margin-bottom:20px}.dsho h3{font-size:16px;margin:0 0 12px}
    .dsho .dsho-config{min-width:0}.dsho .dsho-notice{margin:12px 0 22px;padding:10px 13px;border-radius:0 7px 7px 0;background:#657de009;font-size:12px}
    .dsho .dsho-provider-card{padding:18px 20px;margin:18px 0;border-color:#8993a333;background:var(--dsho-surface)}
    .dsho .dsho-provider-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:15px}
    .dsho .dsho-provider-head h4{font-size:14px;line-height:1.5;margin:0 0 3px}.dsho .dsho-provider-head .dsho-muted{font-size:11px}
    .dsho .dsho-add-model{flex:none;border-color:#657de055;color:var(--dsw-alias-label-primary,inherit);font-size:12px;padding:6px 11px;background:#657de008}
    .dsho .dsho-model-row{margin:12px 0;padding:15px;border-color:#8993a32b;background:#8993a305}
    .dsho .dsho-model-row-head{flex-wrap:wrap;gap:7px;margin-bottom:13px}.dsho .dsho-model-alias{max-width:100%;overflow-wrap:anywhere;white-space:normal}
    .dsho .dsho-chip{font-size:10px;line-height:17px;padding:0 6px;border-color:#657de033;color:#657de0;background:#657de008;white-space:nowrap}
    .dsho .dsho-model-fields{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(130px,.7fr);gap:14px}
    .dsho label{min-width:0;font-size:12px;gap:7px}.dsho input,.dsho select{min-width:0;width:100%;height:36px;font-size:12px;border-color:#8993a347;padding:7px 9px}
    .dsho button:focus-visible,.dsho input:focus-visible,.dsho select:focus-visible{outline:2px solid #657de0;outline-offset:2px}
    .dsho .dsho-model-actions{margin-top:13px;justify-content:flex-end}.dsho .dsho-model-actions button{font-size:11px;padding:3px 8px;border-color:#8993a333}
    .dsho .dsho-provider-card>.dsho-muted{font-size:11px;margin-bottom:0;line-height:1.7}
    .dsho .dsho-save-bar{border-top:1px solid #8993a333;padding-top:18px;margin-top:24px}.dsho .dsho-save-bar button{font-size:12px;border-color:#657de066;background:#657de00d}
    .dsho .dsho-role-tree{padding:22px 0 0;--role-line:#8993a34d;--role-color:#657de0}
    .dsho .dsho-route-root{position:relative;max-width:440px;margin:0 auto;padding:16px 18px;border:1px solid #657de044;border-radius:10px;background:#657de008}
    .dsho .dsho-route-root::after{content:'';position:absolute;left:50%;top:100%;height:14px;border-left:1px solid var(--role-line)}
    .dsho .dsho-route-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsho .dsho-route-heading h4{margin:0;font-size:14px;line-height:1.5}
    .dsho .dsho-route-badge{font-size:10px;line-height:20px;padding:0 6px;border-radius:4px;color:var(--role-color);background:color-mix(in srgb,var(--role-color) 9%,transparent)}
    .dsho .dsho-route-root p{margin:8px 0 5px;font-size:12px}.dsho .dsho-route-root-model{font-size:11px;opacity:.6}
    .dsho .dsho-route-branches{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0;padding:28px 0 0;list-style:none}
    .dsho .dsho-route-branches::before{content:'';position:absolute;top:13px;left:calc((100% - 28px)/6);right:calc((100% - 28px)/6);border-top:1px solid var(--role-line)}
    .dsho .dsho-route-group{position:relative;min-width:0;padding:16px 14px;border:1px solid #8993a333;border-top:2px solid var(--role-color);border-radius:9px;background:var(--dsho-surface)}
    .dsho .dsho-route-group::before{content:'';position:absolute;left:50%;bottom:100%;height:16px;border-left:1px solid var(--role-line)}
    .dsho .dsho-route-role{display:grid;gap:5px;margin-top:15px;min-width:0}.dsho .dsho-route-description{font-size:11px;line-height:1.6;opacity:.58}
    .dsho .dsho-route-review-note{font-size:11px;line-height:1.8;margin:18px 0 0;padding-top:12px;border-top:1px solid #8993a326;opacity:.65}
    .dsho .dsho-route-footnote{font-size:11px;line-height:1.7;margin:14px 0 0;opacity:.6}
    .dsho .dsho-runtime-limits{margin-top:22px;padding-top:18px;border-top:1px solid #8993a333}.dsho .dsho-runtime-limits h4{font-size:13px;margin:0 0 12px}
    .dsho .dsho-runtime-limits .dsho-settings{grid-template-columns:repeat(3,minmax(0,1fr))}
    @container dsho-panel (max-width:620px){.dsho .dsho-route-root{max-width:none;margin-left:20px}.dsho .dsho-route-root::after{left:calc(-20px - 1px);top:50%;width:20px;height:0;border-left:0;border-top:1px solid var(--role-line)}.dsho .dsho-route-branches{grid-template-columns:1fr;padding:18px 0 0 20px;gap:12px}.dsho .dsho-route-branches::before{top:-55px;bottom:0;left:0;right:auto;border-top:0;border-left:1px solid var(--role-line)}.dsho .dsho-route-group::before{left:-21px;top:22px;bottom:auto;width:20px;height:0;border-left:0;border-top:1px solid var(--role-line)}.dsho .dsho-runtime-limits .dsho-settings{grid-template-columns:1fr}}
    .dsho .dsho-unified-models{position:relative;padding:18px 20px;margin:18px 0;border-color:#8993a333;background:var(--dsho-surface)}
    .dsho .dsho-model-input{display:flex;gap:6px;min-width:0}.dsho .dsho-model-input input{flex:1;min-width:0}.dsho .dsho-model-input button{flex:none;padding:4px 7px;font-size:11px;border-color:#8993a333}
    .dsho .dsho-cli-chip{font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;background:#657de010;color:#586fc4}.dsho .dsho-cli-chip.claude-code{background:#26916b10;color:#28896a}
    .dsho .dsho-model-picker{position:absolute;z-index:20;top:68px;left:16px;right:16px;max-width:820px;background:var(--dsho-surface);border:1px solid #8993a347;border-radius:10px;box-shadow:0 10px 36px #12213b1c;overflow:hidden}
    .dsho .dsho-picker-search{display:flex;gap:8px;align-items:center;padding:12px;border-bottom:1px solid #8993a32b}.dsho .dsho-picker-search input{flex:1}.dsho .dsho-picker-search button{border:0;padding:2px 6px;font-size:21px;line-height:26px;background:transparent}
    .dsho .dsho-picker-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.dsho .dsho-picker-column{min-width:0;padding:12px}.dsho .dsho-picker-column+.dsho-picker-column{border-left:1px solid #8993a32b}
    .dsho .dsho-picker-heading{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:0 4px 10px;font-size:12px}.dsho .dsho-picker-heading span{opacity:.5;font-size:10px}
    .dsho .dsho-picker-options{max-height:290px;overflow:auto;scrollbar-width:thin}.dsho .dsho-picker-options button{display:grid;gap:3px;border:0;border-radius:5px;background:transparent;width:100%;text-align:left;padding:8px;font-size:12px;overflow-wrap:anywhere}
    .dsho .dsho-picker-options button:hover,.dsho .dsho-picker-options button[aria-selected=true]{background:#657de010}.dsho .dsho-picker-options small{font-size:10px;opacity:.5;line-height:1.5}
    .dsho .dsho-picker-manual{margin:8px 0 0;font-size:11px;padding:5px 7px;border-color:#8993a333;width:100%;white-space:normal}
    .dsho .dsho-picker-foot{padding:9px 12px;border-top:1px solid #8993a32b;font-size:10px;opacity:.6}
    .dsho .dsho-catalog-warning{font-size:11px;line-height:1.6;color:#a57835;overflow-wrap:anywhere}
    @container dsho-panel (max-width:480px){.dsho .dsho-unified-models{padding:14px 12px}.dsho .dsho-model-picker{left:4px;right:4px}.dsho .dsho-picker-column{padding:8px}.dsho .dsho-picker-heading{align-items:flex-start;flex-direction:column}.dsho .dsho-picker-options button{font-size:11px;padding:7px 4px}}
    @media(max-width:900px){.dsho .dsho-model-fields{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.dsho .dsho-model-fields>label:last-child{grid-column:1/-1}}
    @media(max-width:600px){.dsho{padding:20px 16px 40px}.dsho .dsho-provider-card{padding:14px}.dsho .dsho-model-row{padding:12px}.dsho .dsho-model-fields{grid-template-columns:minmax(0,1fr)}.dsho .dsho-model-fields>label:last-child{grid-column:auto}.dsho .dsho-model-actions{justify-content:flex-start}}
    @container dsho-panel (max-width:700px){.dsho .dsho-model-fields{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.dsho .dsho-model-fields>label:last-child{grid-column:1/-1}}
    @container dsho-panel (max-width:480px){.dsho .dsho-model-fields{grid-template-columns:minmax(0,1fr)}.dsho .dsho-model-fields>label:last-child{grid-column:auto}.dsho .dsho-model-actions{justify-content:flex-start}}
    @media(prefers-color-scheme:dark){.dsho-shell{--dsho-surface:var(--dsw-alias-bg-layer-1,#222630)}}
  `;
  async function api(path, body, signal) {
    const res = await fetch(`/dsh-orchestrator/api/${path}`, {credentials: 'same-origin', cache: 'no-store', signal,
      ...(body ? {method: 'POST', headers: {'content-type': 'application/json', 'x-dsh-orchestrator': '1'}, body: JSON.stringify(body)} : {})});
    const data = await res.json(); if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`); return data;
  }
  const aliasPrefix = provider => provider === 'claude-code' ? 'claude' : 'codex';
  const modelAliasBase = (provider, model) => {
    const part = String(model || 'native').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'native';
    const prefix = aliasPrefix(provider);
    return (part.startsWith(`${prefix}-`) ? part : `${prefix}-${part}`).slice(0, 200).replace(/[-._]+$/g, '');
  };
  function uniqueAlias(base, used) {
    const taken = new Set(used); let alias = base, suffix = 2;
    while (taken.has(alias)) alias = `${base.slice(0, 196)}-${suffix++}`;
    return alias;
  }
  function normalizeClientModels(models) {
    if (Array.isArray(models)) return models.map(entry => ({provider: entry.provider, model: entry.model ?? '', reasoningEffort: entry.reasoningEffort ?? '', alias: entry.alias || '', default: Boolean(entry.default)}));
    if (!models || typeof models !== 'object') return [];
    const entries = [], used = [];
    for (const [provider, value] of Object.entries(models)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const alias = uniqueAlias(modelAliasBase(provider, value.model ?? ''), used);
      used.push(alias);
      entries.push({provider, model: value.model ?? '', reasoningEffort: value.reasoningEffort ?? '', alias, default: true});
    }
    return entries;
  }
  function Settings({data, onSaved, onError}) {
    const [config, setConfig] = useState({...data.config, models: normalizeClientModels(data.config.models)}), [busy, setBusy] = useState(false), [saved, setSaved] = useState('');
    const [catalogs, setCatalogs] = useState(data.modelCatalog ?? {}), [reading, setReading] = useState(false);
    const executionPolicy = config.executionPolicy ?? {codex: {sandbox: 'workspace-write', approval: 'never'}, claude: {readMode: 'dontAsk', writeMode: 'acceptEdits'}};
    const updatePolicy = (provider, key, value) => setConfig({...config, executionPolicy: {...executionPolicy, [provider]: {...executionPolicy[provider], [key]: value}}});
    const [picker, setPicker] = useState(false), [modelSearch, setModelSearch] = useState(''), [showExtraModels, setShowExtraModels] = useState(false);
    const pickerElement = React.useRef(null);
    useEffect(() => {
      if (!picker) return;
      pickerElement.current?.scrollIntoView({block: 'nearest'});
      const outside = event => {if (pickerElement.current && !pickerElement.current.contains(event.target)) setPicker(false);};
      document.addEventListener('mousedown', outside);
      return () => document.removeEventListener('mousedown', outside);
    }, [picker]);
    async function refreshModels() {
      setReading(true);
      try { setCatalogs(await api('models/refresh', {})); }
      catch (e) { onError(e.message); } finally { setReading(false); }
    }
    const fields = {maxConcurrency: '并发上限（1–4）', maxExecutions: '每项运行调用上限（2–100）', taskTimeoutMs: '单次超时（毫秒）'};
    const routeModel = value => config.models.find(entry => entry.alias === value) ?? config.models.find(entry => entry.provider === value && entry.default) ?? config.models.find(entry => entry.provider === value);
    async function save() {
      setBusy(true); setSaved('');
      try {
        const routes = Object.fromEntries(Object.entries(config.routes).map(([role, value]) => [role, routeModel(value)?.alias || value]));
        await api('config', {executionMode: config.executionMode || 'terminal', executionPolicy, maxConcurrency: config.maxConcurrency, maxExecutions: config.maxExecutions, taskTimeoutMs: config.taskTimeoutMs, routes, models: config.models}); setSaved('已保存，下次后端调用生效。'); onSaved(); }
      catch (e) { onError(e.message); } finally { setBusy(false); }
    }
    const updateEntry = (index, patch) => setConfig({...config, models: config.models.map((entry, i) => i === index ? {...entry, ...patch} : entry)});
    const updateModel = (index, model) => {
      const entry = config.models[index], automatic = modelAliasBase(entry.provider, entry.model);
      const used = config.models.filter((_, i) => i !== index).map(item => item.alias);
      updateEntry(index, {model, ...(!entry.alias || entry.alias === automatic ? {alias: uniqueAlias(modelAliasBase(entry.provider, model), used)} : {})});
    };
    const makeDefault = index => {
      const provider = config.models[index]?.provider;
      setConfig({...config, models: config.models.map((entry, i) => entry.provider === provider ? {...entry, default: i === index} : entry)});
    };
    const removeModel = index => {
      const removed = config.models[index], next = config.models.filter((_, i) => i !== index);
      if (removed?.default) {
        const replacement = next.findIndex(entry => entry.provider === removed.provider);
        if (replacement >= 0) next[replacement] = {...next[replacement], default: true};
      }
      setConfig({...config, models: next});
    };
    const chooseModel = (provider, model) => {
      const index = picker?.index ?? -1, previous = config.models[index];
      const alias = uniqueAlias(modelAliasBase(provider, model), config.models.filter((_, i) => i !== index).map(entry => entry.alias));
      if (index < 0) {
        setConfig({...config, models: [...config.models, {provider, model, alias, reasoningEffort: '', default: !config.models.some(entry => entry.provider === provider)}]});
      } else {
        const automatic = modelAliasBase(previous.provider, previous.model);
        const changedProvider = previous.provider !== provider;
        let models = config.models.map((entry, i) => i === index ? {...entry, provider, model,
          alias: !previous.alias || previous.alias === automatic ? alias : previous.alias,
          reasoningEffort: '', default: changedProvider ? !config.models.some(item => item.provider === provider) : entry.default} : entry);
        if (changedProvider && previous.default) {
          const first = models.findIndex(entry => entry.provider === previous.provider);
          if (first >= 0) models = models.map((entry, i) => i === first ? {...entry, default: true} : entry);
        }
        setConfig({...config, models});
      }
      setPicker(false); setModelSearch('');
    };
    const openPicker = index => {setModelSearch(''); setShowExtraModels(false); setPicker({index});};
    function modelPicker() {
      if (!picker) return null;
      return h('div', {ref: pickerElement, className: 'dsho-model-picker', role: 'dialog', 'aria-label': '选择模型', onKeyDown: event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setPicker(false);}}},
        h('div', {className: 'dsho-picker-search'}, h('input', {'aria-label': '搜索模型', autoFocus: true, placeholder: '搜索模型 ID 或名称…', value: modelSearch, onChange: event => setModelSearch(event.target.value)}),
          h('button', {type: 'button', 'aria-label': '关闭模型选择', onClick: () => setPicker(false)}, '×')),
        h('div', {className: 'dsho-picker-columns'}, ...[['codex', 'Codex'], ['claude-code', 'Claude Code']].map(([provider, label]) => {
          const catalog = catalogs[provider] ?? {models: []};
          const byId = new Map(catalog.models.map(model => [model.id, model]));
          for (const entry of config.models.filter(model => model.provider === provider && model.model)) if (!byId.has(entry.model)) byId.set(entry.model, {id: entry.model, label: entry.model, sources: ['已配置']});
          const allModels = [...byId.values()], hasPreferred = provider === 'claude-code' && allModels.some(model => model.preferred);
          const extraCount = hasPreferred ? allModels.filter(model => !model.preferred).length : 0;
          const models = allModels.filter(model => (!hasPreferred || showExtraModels || modelSearch.trim() || model.preferred)
            && `${model.id} ${model.label}`.toLowerCase().includes(modelSearch.toLowerCase().trim()));
          return h('div', {className: 'dsho-picker-column', key: provider},
            h('div', {className: 'dsho-picker-heading'}, h('strong', null, label), h('span', null, `${models.length} 个候选`)),
            extraCount > 0 && h('button', {type: 'button', className: 'dsho-picker-manual', 'aria-expanded': showExtraModels,
              onClick: () => setShowExtraModels(!showExtraModels)}, showExtraModels ? '收起其他候选' : `显示其他候选（${extraCount}）`),
            h('div', {className: 'dsho-picker-options', role: 'listbox', 'aria-label': `${label} 模型候选`},
              ...models.map(model => h('button', {type: 'button', key: model.id, role: 'option',
                'aria-selected': config.models[picker.index]?.provider === provider && config.models[picker.index]?.model === model.id,
                onClick: () => chooseModel(provider, model.id)},
                h('span', null, model.id), h('small', null, [model.preferred ? '已配置入口' : '', model.label !== model.id ? model.label : '', model.hidden ? 'CLI 隐藏候选' : '', ...(model.sources ?? [])].filter(Boolean).join(' · ') || '本地配置 / 缓存'))),
              !models.length && h('p', {className: 'dsho-muted'}, '暂无匹配候选，可刷新目录或手动填写。')),
            catalog.warning && h('p', {className: 'dsho-catalog-warning', role: 'status'}, catalog.warning),
            h('button', {className: 'dsho-picker-manual', type: 'button', onClick: () => chooseModel(provider, '')}, `手动添加 ${label} 模型`));
        })),
        h('div', {className: 'dsho-picker-foot'}, '候选来自本地配置、已配置模型及原生目录；实际可用性以对应后端为准。'));
    }
    function modelList() {
      return h('div', {className: 'dsho-card dsho-unified-models'},
        h('div', {className: 'dsho-provider-head'}, h('div', null, h('h4', null, '统一模型列表'), h('span', {className: 'dsho-muted'}, `${config.models.length} 个模型 · Codex / Claude Code`)),
          h('button', {type: 'button', className: 'dsho-add-model', 'aria-expanded': Boolean(picker), onClick: () => picker ? setPicker(false) : openPicker(-1)}, '+ 添加模型')),
        modelPicker(),
        ...Object.entries(catalogs).filter(([, catalog]) => catalog.warning).map(([provider, catalog]) => h('p', {className: 'dsho-catalog-warning', role: 'status', key: provider}, `${providerLabel(provider)}：${catalog.warning}`)),
        !config.models.length && h('p', {className: 'dsho-muted'}, '尚未添加模型，当前沿用后端原生默认配置。'),
        ...config.models.map((entry, index) => {
          const label = providerLabel(entry.provider), catalog = catalogs[entry.provider] ?? {models: [], efforts: []};
          const known = catalog.models.find(model => model.id === entry.model);
          const efforts = known?.effortSupported === false ? [] : known?.efforts?.length ? known.efforts : catalog.efforts;
          const invalidEffort = entry.reasoningEffort && !efforts.includes(entry.reasoningEffort);
          return h('div', {className: 'dsho-model-row', key: index},
            h('div', {className: 'dsho-model-row-head'}, h('span', {className: `dsho-cli-chip ${entry.provider}`}, label),
              h('span', {className: 'dsho-model-alias'}, entry.alias || '未命名别名'), entry.default && h('span', {className: 'dsho-chip'}, '默认别名')),
            !data.providers.includes(entry.provider) && h('p', {className: 'dsho-error'}, `${label} 后端尚未启用。`),
            h('div', {className: 'dsho-model-fields'},
              h('label', null, '模型 ID', h('div', {className: 'dsho-model-input'},
                h('input', {'aria-label': `${label} 模型 ID：${entry.alias || index + 1}`, value: entry.model, placeholder: '沿用原生配置或填写模型 ID', onChange: event => updateModel(index, event.target.value)}),
                h('button', {type: 'button', 'aria-label': `为 ${entry.alias || label} 选择模型`, onClick: () => openPicker(index)}, '选择 ▾'))),
              h('label', null, '模型别名', h('input', {value: entry.alias, placeholder: modelAliasBase(entry.provider, entry.model), onChange: event => updateEntry(index, {alias: event.target.value})})),
              h('label', null, '推理强度', h('select', {value: invalidEffort ? '' : entry.reasoningEffort, onChange: event => updateEntry(index, {reasoningEffort: event.target.value})}, h('option', {value: ''}, '沿用原生默认'), ...efforts.map(value => h('option', {key: value, value}, value))))),
            h('div', {className: 'dsho-model-actions'},
              h('button', {type: 'button', disabled: entry.default, onClick: () => makeDefault(index), title: `${label} 的默认别名`}, entry.default ? '默认别名' : '设为默认'),
              h('button', {type: 'button', 'aria-label': `移除 ${entry.alias || label + ' 模型'}`, onClick: () => {setPicker(false); removeModel(index);}}, '移除')),
            invalidEffort && h('p', {className: 'dsho-error'}, '所选模型未声明支持当前推理强度，请重新选择。'));
        }),
        h('p', {className: 'dsho-muted'}, '每个模型绑定对应 CLI；默认别名仍按后端分别设置。可从双栏选择器添加，也可手动填写模型 ID。'));
    }
    const routeOptions = [...new Set(config.models.map(entry => entry.alias).filter(Boolean))];
    const routeField = (key, label, description) => h('div', {className: 'dsho-route-role', key},
      h('label', null, label, h('select', {'aria-label': `${{plan: '规划', implement: '开发', test: '验证', research: '研究', review: '审核'}[key]}默认模型`,
        title: routeModel(config.routes[key])?.alias || '请选择模型', value: routeModel(config.routes[key])?.alias || '',
        onChange: e => setConfig({...config, routes: {...config.routes, [key]: e.target.value}})},
        !routeModel(config.routes[key]) && h('option', {value: '', disabled: true}, routeOptions.length ? '请选择模型' : '请先添加模型'),
        ...routeOptions.map(value => h('option', {value, key: value}, value)))),
      h('span', {className: 'dsho-route-description'}, description));
    return h('section', {className: 'dsho-config'}, h('h3', null, '模型与推理强度'),
      h('label', {className: 'dsho-execution-mode'}, '子代理运行方式', h('select', {value: config.executionMode || 'terminal', onChange: event => setConfig({...config, executionMode: event.target.value})}, h('option', {value: 'terminal'}, '可见 CLI 终端（可观看、接管）'), h('option', {value: 'protocol'}, '原生协议（后台运行）'))),
      h('details', {className: 'dsho-execution-permissions'}, h('summary', null, '子代理执行权限与审批'),
        h('p', {className: 'dsho-muted'}, 'Codex权限单独控制沙盒和审批。完全访问权限会允许访问宿主机GPU设备，也会扩大文件和命令访问范围。'),
        h('label', null, 'Codex写任务沙盒', h('select', {value: executionPolicy.codex.sandbox, onChange: e => updatePolicy('codex', 'sandbox', e.target.value)},
          h('option', {value: 'workspace-write'}, '工作目录写入'),
          h('option', {value: 'danger-full-access'}, '完全访问权限（可用于GPU任务）'))),
        h('label', null, 'Codex操作审批', h('select', {value: executionPolicy.codex.approval, onChange: e => updatePolicy('codex', 'approval', e.target.value)},
          h('option', {value: 'never'}, '自动执行沙盒允许的操作'),
          h('option', {value: 'on-request'}, '按需请求批准（原生协议模式可显示DSH审批）'))),
        h('label', null, 'Claude Code写任务权限', h('select', {value: executionPolicy.claude.writeMode, onChange: e => updatePolicy('claude', 'writeMode', e.target.value)},
          h('option', {value: 'acceptEdits'}, '自动允许编辑，其他操作按需审批'),
          h('option', {value: 'default'}, '按需审批'),
          h('option', {value: 'bypassPermissions'}, '完全访问权限'))),
        h('p', {className: 'dsho-muted'}, '只读任务保持受限。Codex终端模式的按需审批需要人工接管终端；原生协议模式通过DSH选项界面转发审批。')),
      h('div', {className: 'dsho-bar'}, h('button', {disabled: reading, onClick: refreshModels}, reading ? '查询原生目录中…' : '刷新模型列表')),
      h('p', {className: 'dsho-notice'}, '主协调 Agent 的模型和推理强度在 DSH 自带的会话模型选择器中设置；下面统一配置被调度的 Codex 和 Claude Code 模型；打开选择器后左侧是 Codex，右侧是 Claude Code。'),
      modelList(),
      h('details', null, h('summary', null, '调度设置与后端路由'),
      h('section', {className: 'dsho-role-tree', 'aria-label': 'Agent 职责树'},
        h('div', {className: 'dsho-route-root'}, h('div', {className: 'dsho-route-heading'}, h('span', {className: 'dsho-route-badge'}, '总调度'), h('h4', null, '主协调 Agent（大拿）')),
          h('p', null, '理解目标、分派任务、汇总各 Agent 的结果'),
          h('span', {className: 'dsho-route-root-model'}, '模型在 DSH 会话底部的模型选择器中设置')),
        h('ul', {className: 'dsho-route-branches'},
          h('li', {className: 'dsho-route-group', style: {'--role-color': '#7b61c9'}}, h('div', {className: 'dsho-route-heading'}, h('span', {className: 'dsho-route-badge'}, '出方案'), h('h4', null, '规划与研究')),
            routeField('plan', '规划方案', '拆解目标，制定实施方案'), routeField('research', '研究分析', '查资料、侦察项目、定位问题')),
          h('li', {className: 'dsho-route-group', style: {'--role-color': '#28896a'}}, h('div', {className: 'dsho-route-heading'}, h('span', {className: 'dsho-route-badge'}, '动手做'), h('h4', null, '执行任务')),
            routeField('implement', '开发实现', '修改代码，落实具体任务'), routeField('test', '测试验证', '运行声明的检查，返回验证证据')),
          h('li', {className: 'dsho-route-group', style: {'--role-color': '#b27b21'}}, h('div', {className: 'dsho-route-heading'}, h('span', {className: 'dsho-route-badge'}, '把关'), h('h4', null, '独立审核')),
            routeField('review', '审核验收', '独立核查执行结果，判断是否通过'), h('p', {className: 'dsho-route-review-note'}, '通过后完成；发现缺陷交回执行，待补验则暂停。'))),
        h('p', {className: 'dsho-route-footnote'}, '在各节点选择默认模型；具体任务可单独指定。连线表示委派关系，实际顺序由任务依赖决定。')),
      h('section', {className: 'dsho-runtime-limits', 'aria-label': '运行限制'}, h('h4', null, '运行限制'),
        h('div', {className: 'dsho-settings'}, ...Object.entries(fields).map(([key, label]) => h('label', {key}, label, h('input', {type: 'number', value: config[key], onChange: e => setConfig({...config, [key]: Number(e.target.value)})})))))),
      h('div', {className: 'dsho-bar dsho-save-bar'}, h('button', {disabled: busy || data.runs.some(r => r.status === 'running'), onClick: save}, busy ? '保存中…' : '保存模型与调度设置'), saved && h('span', {role: 'status'}, saved)));
  }
  function useOrchestratorData(interval = 2500) {
    const [data, setData] = useState(null), [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);
    const refresh = () => setNonce(n => n + 1);
    useEffect(() => {
      let stopped = false, timer; const controller = new AbortController();
      async function tick() {
        try { const next = await api('state', undefined, controller.signal); if (!stopped) {setData(next); setError('');} }
        catch (e) { if (!stopped) setError(e.message); }
        if (!stopped) timer = setTimeout(tick, document.hidden ? 5000 : interval);
      }
      tick(); return () => {stopped = true; clearTimeout(timer); controller.abort();};
    }, [nonce, interval]);
    return {data, error, setError, refresh};
  }
  const providerLabel = value => value === 'codex' ? 'Codex' : value === 'claude-code' ? 'Claude Code' : value || '未知后端';
  const targetLabel = value => value === 'codex' || value === 'claude-code' ? providerLabel(value) : (value || '未知目标');
  const traceTime = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(); };
  const laneColors = ['#657de0', '#26916b', '#c7527a', '#b27b21', '#8a63c7', '#2889a6', '#c45c3d', '#6c7a3a'];
  const returnLabels = {completed: '返回', failed: '失败', interrupted: '中断', cancelled: '取消', timed_out: '超时'};
  const dispositionLabels = {pass: '审核通过', defect: '缺陷返工', blocked: '等待补验'};
  function callerMeta(call) {
    const target = call.modelAlias ? `${providerLabel(call.provider)} · ${call.modelAlias}` : providerLabel(call.provider);
    return [target, call.phase, call.attempt ? `第 ${call.attempt} 次` : '',
      call.model ? `${call.model}${call.reasoningEffort ? ` / ${call.reasoningEffort}` : ''}` : '原生默认模型'].filter(Boolean).join(' · ');
  }
  function sessionHints(call) {
    const hints = [];
    if (call.nativeSessionId) hints.push(`原生会话：${call.nativeSessionId} · ${call.sessionResumed ? '恢复' : '新建'}${call.contextEvents?.some(event => event.type === 'compacted') ? ' · 已压缩' : ''}`);
    if (call.sessionChangedReason) hints.push(`会话切换：${call.sessionChangedReason}`);
    hints.push(`调用 ID：${call.childId || call.id}`);
    return hints;
  }
  function sendNode(call) {
    return {key: `${call.id}-send`, at: call.startedAt, kind: '发出', call,
      cls: ['starting', 'running'].includes(call.status) ? 'is-active' : '',
      preview: ['starting', 'running'].includes(call.status) ? '等待返回…' : `发出 ${call.phase} 调用${call.title ? ` · ${call.title}` : ''}`,
      body: call.input || `任务：${call.title || call.taskId}\n旧记录未保存发送正文。`,
      meta: callerMeta(call), hints: [...(call.inputTruncated ? ['正文超出记录上限，已截断。'] : []), ...sessionHints(call)]};
  }
  function returnNode(call) {
    const kind = returnLabels[call.status] || '返回', abnormal = ['failed', 'interrupted', 'cancelled', 'timed_out'].includes(call.status);
    const disposition = call.reviewDisposition ? dispositionLabels[call.reviewDisposition] : '';
    const reviewAttention = ['defect', 'blocked'].includes(call.reviewDisposition);
    return {key: `${call.id}-return`, at: call.endedAt || call.startedAt, kind, call,
      cls: ['failed', 'timed_out'].includes(call.status) || call.reviewDisposition === 'blocked' ? 'is-failed' : abnormal || reviewAttention ? 'is-abnormal' : 'is-returned',
      badgeClass: ['failed', 'timed_out', 'interrupted', 'cancelled'].includes(call.status) || call.reviewDisposition === 'blocked' ? 'failed' : reviewAttention ? 'attention' : 'returned',
      preview: [disposition, call.error || call.output || (['starting', 'running'].includes(call.status) ? '等待返回…' : '未保存返回正文')].filter(Boolean).join(' · '),
      body: call.error || call.output || '未保存返回正文', meta: callerMeta(call),
      hints: [...(call.outputTruncated ? ['正文超出记录上限，已截断。'] : []), ...(disposition ? [`审核结论：${disposition}`] : []), ...sessionHints(call)]};
  }
  function buildLanes(run) {
    const tasks = Array.isArray(run.tasks) ? run.tasks : [];
    const calls = [...(run.calls ?? [])].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const byTask = new Map();
    for (const call of calls) {
      if (!byTask.has(call.taskId)) byTask.set(call.taskId, []);
      byTask.get(call.taskId).push(call);
    }
    const taskIds = new Set(tasks.map(task => task.id));
    const titleById = new Map(tasks.map(task => [task.id, task.title]));
    const children = new Map();
    for (const task of tasks) for (const dependency of task.dependsOn ?? []) {
      if (!children.has(dependency)) children.set(dependency, []);
      children.get(dependency).push(task.id);
    }
    const lanes = tasks.map((task, index) => {
      const taskCalls = byTask.get(task.id) ?? [], nodes = [];
      if (!taskCalls.length) {
        const state = labels[task.state] || task.state || '待执行';
        const waiting = task.dependsOn?.length ? `等待 ${task.dependsOn.join('、')}` : '';
        nodes.push({key: `${task.id}-state`, at: run.updatedAt || run.createdAt, kind: '状态',
          cls: task.state === 'failed' ? 'is-failed' : task.state === 'completed' ? 'is-returned' : 'is-waiting',
          badgeClass: task.state === 'failed' ? 'failed' : task.state === 'completed' ? 'returned' : '',
          preview: [state, waiting].filter(Boolean).join(' · '), meta: task.access === 'read' ? '只读' : '可写',
          body: task.error || task.review?.evidence || (task.dependsOn?.length ? `前置任务：${task.dependsOn.join('、')}` : '当前任务尚无调用记录。'), hints: []});
      } else {
        for (const call of taskCalls) {
          nodes.push(sendNode(call));
          if (!['starting', 'running'].includes(call.status)) nodes.push(returnNode(call));
        }
      }
      return {task, calls: taskCalls, nodes, index, color: laneColors[index % laneColors.length],
        deps: (task.dependsOn ?? []).map(id => titleById.get(id) || id), downstream: (children.get(task.id) ?? []).map(id => titleById.get(id) || id)};
    });
    for (const [taskId, taskCalls] of byTask) {
      if (taskIds.has(taskId)) continue;
      const nodes = [];
      for (const call of taskCalls) { nodes.push(sendNode(call)); if (!['starting', 'running'].includes(call.status)) nodes.push(returnNode(call)); }
      const title = taskCalls[0]?.title || taskId;
      lanes.push({task: {id: taskId, title, state: '', attempts: 0, maxAttempts: 0, dependsOn: []}, calls: taskCalls, nodes,
        index: lanes.length, color: laneColors[lanes.length % laneColors.length], deps: [], downstream: []});
    }
    return lanes;
  }
  function laneProviders(lane) {
    const executions = lane.calls.filter(call => call.phase === '执行');
    const reviews = lane.calls.filter(call => call.phase === '审核');
    const execute = lane.task.executionSelection?.alias || lane.task.executedAlias || executions.findLast(call => call.modelAlias)?.modelAlias || lane.task.executedProvider || executions.at(-1)?.provider || lane.task.provider;
    const review = lane.task.reviewSelection?.alias || lane.task.reviewAlias || reviews.findLast(call => call.modelAlias)?.modelAlias || lane.task.reviewProvider || reviews.at(-1)?.provider || lane.task.reviewer;
    const values = [];
    if (execute) values.push(targetLabel(execute));
    if (review && review !== execute) values.push(targetLabel(review));
    return values.join(' → ');
  }
  function handoffGraph(run, lanes) {
    if (!lanes.length) return null;
    const mainX = 30, rowHeight = 44, events = [], entries = [], edges = [], active = new Map();
    const laneByTask = new Map(lanes.map(lane => [lane.task.id, lane]));
    const coordinator = run.coordinator;
    const mainLabel = coordinator?.model ? `${coordinator.provider ? providerLabel(coordinator.provider) + ' · ' : ''}${coordinator.model}` : '协调主线';
    const mainColor = '#a34fd3';
    const numericTime = (value, fallback) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : fallback;
    for (const [index, call] of (run.calls ?? []).entries()) {
      const start = numericTime(call.startedAt, index * 2);
      events.push({call, kind: 'work', time: start, order: index * 2});
      if (!['starting', 'running'].includes(call.status)) events.push({call, kind: 'return',
        time: Math.max(start, numericTime(call.endedAt, start)), order: index * 2 + 1});
    }
    events.sort((a, b) => a.time - b.time || a.order - b.order);
    let maxSlot = 0;
    const add = entry => {entry.y = 48 + entries.length * rowHeight; entries.push(entry); return entry;};
    add({id: 'run-start', x: mainX, color: mainColor, title: '编排主线', meta: mainLabel, kind: 'root'});
    for (const event of events) {
      const {call, kind} = event, lane = laneByTask.get(call.taskId);
      if (!lane) continue;
      const worker = [providerLabel(call.provider), call.modelAlias].filter(Boolean).join(' · ');
      const color = call.provider === 'claude-code' ? '#23a478' : call.provider === 'codex' ? '#587de0' : lane.color;
      if (kind === 'work') {
        const occupied = new Set([...active.values()].map(branch => branch.slot));
        let slot = 1; while (occupied.has(slot)) slot++;
        maxSlot = Math.max(maxSlot, slot);
        const x = mainX + slot * 30;
        const entry = add({id: `${call.id}-work`, x, color, lane, call, kind, actor: worker,
          title: call.title || lane.task.title, meta: `${call.phase} · 第 ${call.attempt ?? '?'} 次`,
          status: ['starting', 'running'].includes(call.status) ? '等待返回' : '发出'});
        const sourceY = entry.y - rowHeight / 2;
        edges.push({id: `${call.id}-fork`, callId: call.id, taskId: call.taskId, kind: 'fork', color,
          d: `M ${mainX} ${sourceY} C ${mainX} ${sourceY + 12}, ${x} ${entry.y - 12}, ${x} ${entry.y}`});
        active.set(call.id, {slot, x, entry, color});
      } else {
        const branch = active.get(call.id);
        if (!branch) continue;
        const entry = add({id: `${call.id}-return`, x: mainX, color: branch.color, lane, call, kind, actor: worker,
          title: call.title || lane.task.title, meta: `${call.phase} · 第 ${call.attempt ?? '?'} 次`,
          status: dispositionLabels[call.reviewDisposition] || returnLabels[call.status] || '返回'});
        const bendY = entry.y - rowHeight / 2;
        edges.push({id: `${call.id}-merge`, callId: call.id, taskId: call.taskId, kind: 'merge', color: branch.color,
          d: `M ${branch.x} ${branch.entry.y} L ${branch.x} ${bendY} C ${branch.x} ${bendY + 12}, ${mainX} ${entry.y - 12}, ${mainX} ${entry.y}`});
        active.delete(call.id);
      }
    }
    const tail = add({id: 'run-state', x: mainX, color: mainColor, title: labels[run.status] || run.status || '待执行',
      meta: active.size ? `${active.size} 个调用等待返回` : '编排运行状态', kind: 'state'});
    for (const [callId, branch] of active) edges.push({id: `${callId}-open`, callId, taskId: branch.entry.call.taskId, kind: 'open', color: branch.color,
      d: `M ${branch.x} ${branch.entry.y} L ${branch.x} ${tail.y + 12}`});
    // 尚未发出的任务单独列出，不能画成已经发生的调用和回接。
    for (const lane of lanes.filter(item => !item.calls.length)) add({id: `${lane.task.id}-pending`, x: mainX, lane,
      color: '#8e98a8', kind: 'pending', title: lane.task.title, meta: laneProviders(lane) || '尚未分配后端', status: '尚未调用'});
    const labelX = mainX + Math.max(1, maxSlot) * 30 + 30;
    return {entries, edges, mainX, mainColor, mainLabel, mainEnd: tail.y, labelX, width: labelX + 560, height: entries.at(-1).y + 36};
  }
  function TraceNode({node}) {
    return h('div', {className: `dsho-node ${node.cls || ''}`},
      h('span', {className: 'dsho-node-dot', 'aria-hidden': 'true'}),
      h('details', null,
        h('summary', null,
          h('span', {className: 'dsho-node-head'},
            h('span', {className: `badge ${node.badgeClass || ''}`}, node.kind),
            h('span', {className: 'dsho-node-meta', title: node.meta}, [traceTime(node.at), node.meta].filter(Boolean).join(' · '))),
          h('span', {className: 'dsho-node-preview'}, node.preview || '')),
        h('pre', null, node.body || '无正文'),
        ...(node.hints ?? []).map((hint, index) => h('div', {className: 'hint', key: index}, hint))));
  }
  function BranchRun({run, lanes}) {
    const graph = handoffGraph(run, lanes);
    const [selectedId, setSelectedId] = useState('');
    const [scale, setScale] = useState(1), [autoFit, setAutoFit] = useState(true);
    const viewport = React.useRef(null);
    const selectedEntry = graph?.entries.find(entry => entry.id === selectedId);
    const selected = selectedEntry?.lane;
    const selectedCall = selectedEntry?.call;
    const enterTerminal = call => window.dispatchEvent(new CustomEvent('dsho-open-terminal', {detail: {owner: run.owner, id: call.terminalId}}));
    const selectedNodes = selectedCall ? selected?.nodes.filter(node => node.call?.id === selectedCall.id) : selected?.nodes;
    useEffect(() => {
      const element = viewport.current;
      if (!autoFit || !element || !graph) return;
      const fit = () => setScale(Math.max(.7, Math.min(1, (element.clientWidth - 24) / graph.width)));
      fit(); const observer = new ResizeObserver(fit); observer.observe(element);
      return () => observer.disconnect();
    }, [autoFit, graph?.width, Boolean(selected)]);
    if (!graph) return null;
    return h('div', {className: `dsho-branch-workspace${selected ? ' has-selection' : ''}`},
      h('div', {className: 'dsho-branch-main'},
        h('div', {className: 'dsho-branch-controls', 'aria-label': '分支图缩放'},
          h('span', null, '分支与回接 · 从上向下'),
          h('button', {type: 'button', 'aria-label': '缩小分支图', onClick: () => {setAutoFit(false); setScale(Math.max(.25, scale - .15));}}, '−'),
          h('span', {className: 'dsho-branch-zoom'}, `${Math.round(scale * 100)}%`),
          h('button', {type: 'button', 'aria-label': '放大分支图', onClick: () => {setAutoFit(false); setScale(Math.min(1.5, scale + .15));}}, '+'),
          h('button', {type: 'button', onClick: () => setAutoFit(true), 'aria-pressed': autoFit}, '适应画布')),
      h('div', {className: 'dsho-branch-viewport', ref: viewport, tabIndex: 0, role: 'group', 'aria-label': '任务分支图'},
        h('div', {style: {width: graph.width * scale, height: graph.height * scale, margin: 0}},
        h('div', {className: 'dsho-branch-canvas', style: {width: graph.width, height: graph.height, transform: `scale(${scale})`, transformOrigin: 'top left'}},
          h('svg', {className: 'dsho-branch-lines', width: graph.width, height: graph.height, 'aria-hidden': 'true'},
            h('path', {className: 'dsho-git-mainline', d: `M ${graph.mainX} 48 L ${graph.mainX} ${graph.mainEnd}`, stroke: graph.mainColor}),
            ...graph.edges.map(edge => h('path', {key: edge.id, d: edge.d,
              className: `dsho-branch-edge${edge.kind === 'open' ? ' is-open' : ''}${edge.callId === selectedCall?.id ? ' is-connected' : ''}`,
              'data-call-id': edge.callId, 'data-edge-kind': edge.kind, stroke: edge.color})),
            ...graph.entries.map(entry => h('circle', {key: entry.id, cx: entry.x, cy: entry.y, r: entry.id === selectedId ? 5.5 : 3.5,
              fill: entry.kind === 'pending' || entry.status === '等待返回' ? 'var(--branch-surface)' : entry.color,
              stroke: entry.color, strokeWidth: 2, 'data-event-id': entry.id}))),
          ...graph.entries.map(entry => {
            const abnormal = entry.call && (['failed', 'interrupted', 'cancelled', 'timed_out'].includes(entry.call.status) || ['defect', 'blocked'].includes(entry.call.reviewDisposition));
            return h(React.Fragment, {key: entry.id}, h(entry.lane ? 'button' : 'div', {key: entry.id, ...(entry.lane ? {type: 'button', onClick: () => setSelectedId(entry.id), 'aria-pressed': entry.id === selectedId,
              'aria-label': `${entry.kind === 'return' ? '回接' : entry.kind === 'work' ? '分派' : '等待'}：${entry.title}，${entry.status}`} : {}),
              className: `dsho-git-row${entry.id === selectedId ? ' is-selected' : ''}${abnormal && entry.kind === 'return' ? ' is-error' : ''}`,
              'data-task-id': entry.lane?.task.id, 'data-call-id': entry.call?.id, 'data-event-kind': entry.kind,
              style: {left: 0, paddingLeft: graph.labelX + 8, paddingRight: entry.id === selectedId && entry.call ? 132 : 8, top: entry.y - 19, width: graph.width - 20, height: 38, '--branch-color': entry.color}},
              h('span', {className: 'dsho-git-row-title'},
                h('span', {className: `dsho-git-tag ${entry.kind}`}, entry.kind === 'work' ? '分出' : entry.kind === 'return' ? '回接' : entry.kind === 'pending' ? '等待' : entry.kind === 'root' ? '主干' : '当前'),
                h('span', {className: 'dsho-git-title'}, entry.title),
                entry.status && h('span', {className: 'dsho-git-status'}, entry.status)),
              h('span', {className: 'dsho-git-row-meta'}, [entry.actor, entry.meta, entry.call && traceTime(entry.kind === 'return' ? entry.call.endedAt : entry.call.startedAt)].filter(Boolean).join(' · '))),
              entry.id === selectedId && entry.call && h('button', {type: 'button', className: 'dsho-git-terminal',
                style: {top: entry.y - 14, right: 28}, disabled: !entry.call.terminalId,
                title: entry.call.terminalId ? '打开本次调用对应的子代理终端' : '此调用未关联终端，旧记录或原生协议调用没有可进入的终端',
                'aria-label': `进入终端：${entry.title}，${entry.call.phase}，第 ${entry.call.attempt ?? '?'} 次`,
                onClick: () => enterTerminal(entry.call)}, entry.call.terminalId ? '进入终端 ↗' : '未关联终端'));
          }))))),
      selected && h('aside', {className: 'dsho-branch-inspector', 'aria-label': `节点详情：${selected.task.title}`, style: {'--dsho-lane': selected.color}},
        h('div', {className: 'dsho-branch-inspector-head'}, h('div', null, h('span', {className: 'hint'}, selectedCall ? '调用分支' : '待执行任务'), h('h3', null, selected.task.title)),
          h('button', {type: 'button', 'aria-label': '收起节点详情', onClick: () => setSelectedId('')}, '×')),
        h('div', {className: 'dsho-branch-facts'},
          h('span', null, `任务状态：${labels[selected.task.state] || '历史调用'}${selected.task.attempts ? ` · 第 ${selected.task.attempts}/${selected.task.maxAttempts ?? '?'} 次` : ''}`),
          selectedCall && h('span', null, `本次调用：${['starting', 'running'].includes(selectedCall.status) ? '等待返回' : returnLabels[selectedCall.status] || selectedCall.status} · 第 ${selectedCall.attempt ?? '?'} 次${selectedCall.reviewDisposition ? ' · ' + dispositionLabels[selectedCall.reviewDisposition] : ''}`),
          h('span', null, laneProviders(selected) || '尚未路由'),
          selectedCall && h('button', {type: 'button', className: 'dsho-branch-enter-terminal', disabled: !selectedCall.terminalId, onClick: () => enterTerminal(selectedCall), title: selectedCall.terminalId ? '打开本次调用对应的终端' : '旧记录或原生协议调用没有关联终端'}, selectedCall.terminalId ? '进入终端' : '未关联终端'),
          selected.deps.length > 0 && h('span', null, `依赖：${selected.deps.join('、')}`),
          selected.downstream.length > 0 && h('span', null, `下游：${selected.downstream.join('、')}`)),
        h('div', {className: 'dsho-branch-evidence'}, h('div', {className: 'dsho-branch-section-title'}, selectedCall ? `${providerLabel(selectedCall.provider)} · ${selectedCall.phase} · 第 ${selectedCall.attempt ?? '?'} 次` : '任务状态'),
          h('div', {className: 'dsho-lane-timeline'}, ...(selectedNodes ?? []).map(node => h(TraceNode, {key: node.key, node}))))));
  }
  function RunAttention({run}) {
    if (!['blocked', 'paused'].includes(run.status)) return null;
    const problems = (run.tasks ?? []).filter(task => task.error && !['completed', 'cancelled'].includes(task.state));
    if (!problems.length) return null;
    return h('details', {className: 'dsho-run-attention'},
      h('summary', null, h('span', {className: 'dsho-attention-label'}, '需要处理的原因'), h('span', {className: 'dsho-attention-preview'}, problems[0].error)),
      h('div', {className: 'dsho-attention-body'}, ...problems.map(task => h('div', {key: task.id}, h('strong', null, task.title || task.id), h('p', null, task.error))),
        h('span', {className: 'hint'}, '点击失败或中断的调用行可查看详细记录。排查后需要显式恢复，停止的任务不会自动重放。')));
  }
  function BranchView({runs}) {
    const visible = runs.map(run => ({run, lanes: buildLanes(run)})).filter(item => item.lanes.length);
    return h('div', {className: 'dsho-lanes', 'aria-label': '任务分支视图'},
      ...visible.map(({run, lanes}) => h('section', {className: 'dsho-run', key: run.id},
        h('div', {className: 'dsho-run-head'},
          h('span', {className: `dsho-run-state ${run.status === 'completed' ? 'is-completed' : run.status === 'paused' || run.status === 'blocked' ? 'is-attention' : ''}`}, labels[run.status] || run.status),
          h('span', {className: 'dsho-run-goal', title: run.goal}, run.goal),
          run.cwd && h('span', {className: 'dsho-run-cwd', title: run.cwd}, run.cwd),
          h('time', {className: 'dsho-run-time'}, traceTime(run.createdAt))),
        h(RunAttention, {run}),
        h(BranchRun, {run, lanes}))));
  }
  const branchCss = `
    .dsho-trace{--branch-surface:var(--dsw-alias-bg-layer-1,#fff);--branch-line:#8993a32b;color:var(--dsw-alias-label-primary,#293244);font-family:system-ui,sans-serif}
    @media(prefers-color-scheme:dark){.dsho-trace{--branch-surface:var(--dsw-alias-bg-layer-1,#222630)}}
    .dsho-trace{box-sizing:border-box;max-width:1440px;margin:0 auto;padding:16px 28px 112px;overflow-wrap:anywhere}
    .dsho-trace *{box-sizing:border-box}.dsho-trace .dsho-lanes{gap:24px;padding-top:18px}
    .dsho-trace .dsho-run-head{flex-wrap:wrap;row-gap:6px}.dsho-trace .dsho-run-goal{flex:1 1 280px;white-space:normal;overflow-wrap:anywhere;line-height:1.65}
    .dsho-trace .dsho-run-cwd{flex:0 1 220px}.dsho-trace .dsho-run-time{font-size:10px}
    .dsho-trace .dsho-run-attention{margin:0 0 12px;padding:9px 12px;border:1px solid #d6933833;border-radius:8px;background:#d6933808;font-size:11px}
    .dsho-trace .dsho-run-attention summary{display:flex;align-items:baseline;gap:10px;min-width:0}.dsho-trace .dsho-attention-label{flex:none;color:#ac7427;font-weight:600}
    .dsho-trace .dsho-attention-preview{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.7}
    .dsho-trace .dsho-run-attention[open] .dsho-attention-preview{display:none}.dsho-trace .dsho-attention-body{padding-top:10px;line-height:1.7}
    .dsho-trace .dsho-attention-body p{margin:4px 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}
    @media(max-width:700px){.dsho-trace{padding:12px 16px 100px}.dsho-trace .dsho-run-goal{flex-basis:210px}.dsho-trace .dsho-run-cwd{max-width:100%}}
    .dsho-trace .dsho-agent-terminals{margin:0 0 14px;border:1px solid var(--branch-line);border-radius:8px;padding:10px 12px}
    .dsho-trace .dsho-agent-terminals>summary{font-size:12px;font-weight:600}.dsho-trace .dsho-terminal-panel{padding-top:12px}
    .dsho-trace .dsho-terminal-launch{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;padding:0}
    .dsho-trace .dsho-terminal-dialog{position:fixed;inset:0;margin:auto;width:min(1120px,94vw);max-width:94vw;max-height:88vh;max-height:88dvh;padding:0;border:1px solid var(--branch-line);border-radius:14px;background:var(--branch-surface);color:inherit;box-shadow:0 24px 80px #0005;overflow:hidden}
    .dsho-trace .dsho-terminal-dialog[open]{display:flex;flex-direction:column}
    .dsho-trace .dsho-terminal-dialog::backdrop{background:#10182880}
    .dsho-trace .dsho-terminal-dialog-head{display:flex;align-items:center;gap:14px;flex:none;padding:15px 20px;border-bottom:1px solid var(--branch-line)}
    .dsho-trace .dsho-terminal-dialog-head strong{font-size:14px}.dsho-trace .dsho-terminal-dialog-head .hint{flex:1}
    .dsho-trace .dsho-terminal-dialog-head button{margin-left:auto;border:0;background:transparent;color:inherit;font:inherit;font-size:24px;line-height:24px;cursor:pointer}
    .dsho-trace .dsho-terminal-dialog .dsho-terminal-panel{padding:16px 20px;overflow:auto;overscroll-behavior:contain;min-height:0}
    .dsho-trace .dsho-terminal-dialog pre.dsho-terminal-screen{max-height:52vh;max-height:52dvh;margin:0}
    @media(max-width:600px){.dsho-trace .dsho-terminal-dialog-head{padding:12px}.dsho-trace .dsho-terminal-dialog-head .hint{display:none}.dsho-trace .dsho-terminal-dialog .dsho-terminal-panel{padding:12px}}
    .dsho-trace .dsho-terminal-toolbar,.dsho-trace .dsho-terminal-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:9px}
    .dsho-trace .dsho-terminal-toolbar select{min-width:0;max-width:100%;flex:1;padding:6px;border:1px solid var(--branch-line);border-radius:6px;background:var(--branch-surface);color:inherit;font:inherit;font-size:11px}
    .dsho-trace .dsho-terminal-actions button,.dsho-trace .dsho-terminal-input button{font:inherit;font-size:11px;color:inherit;border:1px solid var(--branch-line);border-radius:5px;background:transparent;padding:5px 9px;cursor:pointer}
    .dsho-trace pre.dsho-terminal-screen{background:#161b22;color:#d6dee8;font:12px/1.5 ui-monospace,monospace;white-space:pre;overflow:auto;padding:14px;border-radius:6px;min-height:180px;max-height:460px;outline-offset:2px}
    .dsho-trace .dsho-terminal-input textarea{box-sizing:border-box;width:100%;min-height:68px;resize:vertical;border:1px solid var(--branch-line);border-radius:5px;background:var(--branch-surface);color:inherit;font:inherit;padding:8px}
    .dsho-trace .dsho-terminal-error{color:#bf4f38;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
    .dsho-trace .dsho-branch-workspace{display:grid;grid-template-columns:minmax(0,1fr);border:1px solid var(--branch-line);border-radius:12px;overflow:hidden;min-width:0;background:var(--branch-surface)}
    .dsho-trace .dsho-branch-workspace.has-selection{grid-template-columns:minmax(0,1fr) 300px}
    .dsho-trace .dsho-branch-main{min-width:0}
    .dsho-trace .dsho-branch-controls{display:flex;align-items:center;gap:6px;padding:9px 13px;border-bottom:1px solid var(--branch-line);font-size:10px;color:inherit}
    .dsho-trace .dsho-branch-controls>span:first-child{opacity:.5;margin-right:auto}
    .dsho-trace .dsho-branch-controls button{font:inherit;color:inherit;background:transparent;border:1px solid transparent;border-radius:5px;padding:3px 7px;cursor:pointer}
    .dsho-trace .dsho-branch-controls button:hover{border-color:var(--branch-line);background:#8881}
    .dsho-trace .dsho-branch-zoom{font-variant-numeric:tabular-nums;opacity:.55;min-width:33px;text-align:center}
    .dsho-trace .dsho-branch-viewport{min-width:0;overflow:auto;max-height:min(78vh,900px);scrollbar-width:thin;outline-offset:-3px}
    .dsho-trace .dsho-branch-canvas{position:relative;min-width:100%}
    .dsho-trace .dsho-branch-lines{position:absolute;inset:0;pointer-events:none;overflow:visible}
    .dsho-trace .dsho-git-mainline{fill:none;stroke-width:2}
    .dsho-trace .dsho-branch-edge{fill:none;stroke-width:2;opacity:.88}
    .dsho-trace .dsho-branch-edge.is-open{stroke-dasharray:4 4}
    .dsho-trace .dsho-branch-edge.is-connected{stroke-width:3;opacity:1}
    .dsho-trace .dsho-git-row{position:absolute;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;text-align:left;gap:2px;padding:2px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;cursor:default;min-width:0}
    .dsho-trace button.dsho-git-row{cursor:pointer}
    .dsho-trace .dsho-git-terminal{position:absolute;z-index:1;font:inherit;font-size:11px;line-height:18px;padding:4px 9px;border:1px solid #667bdf55;border-radius:5px;background:var(--branch-surface);color:#536ad4;cursor:pointer}
    .dsho-trace .dsho-git-terminal:disabled{color:inherit;opacity:.45;cursor:default;border-color:var(--branch-line)}
    .dsho-trace .dsho-branch-enter-terminal{justify-self:start;font:inherit;color:#536ad4;border:1px solid #667bdf55;background:transparent;border-radius:5px;padding:4px 10px;cursor:pointer}
    .dsho-trace .dsho-branch-enter-terminal:disabled{opacity:.5;cursor:default}
    .dsho-trace button.dsho-git-row:hover{background:#8795ab10}
    .dsho-trace .dsho-git-row.is-selected{background:color-mix(in srgb,var(--branch-color) 10%,transparent);outline:1px solid color-mix(in srgb,var(--branch-color) 35%,transparent)}
    .dsho-trace .dsho-git-row-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;line-height:17px}
    .dsho-trace .dsho-git-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}
    .dsho-trace .dsho-git-tag{color:var(--branch-color);background:color-mix(in srgb,var(--branch-color) 9%,transparent);border-radius:4px;padding:0 5px;font-size:10px;flex:none}
    .dsho-trace .dsho-git-status{margin-left:auto;white-space:nowrap;flex:none;font-size:10px;opacity:.65}
    .dsho-trace .dsho-git-row-meta{opacity:.52;font-size:10px;line-height:14px;padding-left:36px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsho-trace .dsho-git-row.is-error .dsho-git-status{color:#d34e4e;opacity:1}
    .dsho-trace .dsho-branch-inspector{min-width:0;border-left:1px solid var(--branch-line);max-height:min(78vh,900px);overflow:auto;scrollbar-width:thin;background:var(--branch-surface)}
    .dsho-trace .dsho-branch-inspector-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:17px 15px 11px}
    .dsho-trace .dsho-branch-inspector-head h3{font-size:14px;line-height:1.5;margin:3px 0 0;overflow-wrap:anywhere}
    .dsho-trace .dsho-branch-inspector-head button{font:inherit;font-size:21px;line-height:22px;border:0;background:transparent;color:inherit;opacity:.5;cursor:pointer;padding:0 2px}
    .dsho-trace .dsho-branch-facts{display:grid;gap:5px;padding:0 15px 15px;border-bottom:1px solid var(--branch-line);font-size:11px;line-height:1.6;opacity:.68;overflow-wrap:anywhere}
    .dsho-trace .dsho-branch-evidence{padding:14px 15px}
    .dsho-trace .dsho-branch-section-title{font-size:11px;font-weight:600;opacity:.6;margin-bottom:2px}
    .dsho-trace .dsho-branch-warning{font-size:11px;margin:8px 12px;color:#ac7427}
    .dsho-trace .dsho-run-head{padding:5px 2px 12px}.dsho-trace .dsho-run-cwd{max-width:190px}
    @media(max-width:900px){.dsho-trace .dsho-branch-workspace.has-selection{grid-template-columns:minmax(0,1fr)}.dsho-trace .dsho-branch-inspector{border-left:0;border-top:1px solid var(--branch-line);max-height:330px}.dsho-trace .dsho-branch-viewport{max-height:480px}.dsho-trace .viewbar .hint{display:none}}
    @media(prefers-reduced-motion:reduce){.dsho-trace .dsho-branch-status i{animation:none!important}}
  `;
  function TimeView({events}) {
    return h('table', {'aria-label': 'Agent 发出与返回'}, h('tbody', null, ...events.map(event => {
      const call = event.call, sending = event.kind === '发出', failed = call.status === 'failed' || ['中断', '取消', '超时'].includes(event.kind);
      return h('tr', {key: event.key, 'data-call-id': call.id, className: !sending && (call.status === 'failed' || call.status === 'timed_out') ? 'is-failed' : ''},
        h('td', {className: 'when'}, traceTime(event.at)),
        h('td', {className: 'kind'}, h('span', {className: `badge ${sending ? '' : failed ? 'failed' : 'returned'}`}, event.kind)),
        h('td', {className: 'agent', title: `${call.modelAlias ? `${call.modelAlias} · ` : ''}${call.model || '原生默认模型'} / ${call.reasoningEffort || '原生默认强度'}`}, providerLabel(call.provider), h('span', {className: 'phase'}, call.modelAlias ? `${call.modelAlias} · ${call.phase}` : call.phase)),
        h('td', null, h('details', null, h('summary', null, event.preview.slice(0, 240), sending && ['starting', 'running'].includes(call.status) && h('span', {className: 'hint'}, ' · 等待返回…')),
          h('pre', null, event.text), event.truncated && h('div', {className: 'hint'}, '正文超出记录上限，已截断。'),
          ...sessionHints(call).map((hint, index) => h('div', {className: 'hint', key: index}, hint)))));
    })));
  }
  function AgentTerminals({owner, runs}) {
    const [open, setOpen] = useState(false), [selectedId, setSelectedId] = useState('');
    const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [input, setInput] = useState('');
    const dialogRef = React.useRef(null), screenRef = React.useRef(null), inputQueue = React.useRef(Promise.resolve()), controlRef = React.useRef({}), queuedInput = React.useRef(0);
    const [control, setControl] = useState({id: '', lease: ''}); controlRef.current = control;
    const selected = items.find(item => item.id === selectedId);
    const terminalStatus = status => ({starting: '启动中', idle: '空闲', running: '执行中', waiting: '等待处理', closed: '已关闭', exited: '已退出', failed: '异常'}[status] ?? status);
    const terminalClosed = ['closed', 'exited', 'failed'].includes(selected?.status);
    const runFinished = ['completed', 'cancelled'].includes(runs?.find(run => run.id === selected?.runId)?.status);
    useEffect(() => {
      const show = event => {if (event.detail?.owner === owner) {
        setSelectedId(event.detail.id); setOpen(true);
        if (dialogRef.current?.open) screenRef.current?.focus({preventScroll: true});
      }};
      window.addEventListener('dsho-open-terminal', show); return () => window.removeEventListener('dsho-open-terminal', show);
    }, [owner]);
    useEffect(() => {
      const dialog = dialogRef.current;
      if (open && dialog && !dialog.open) dialog.showModal();
      if (!open && dialog?.open) dialog.close();
      return () => {if (dialog?.open) dialog.close();};
    }, [open]);
    useEffect(() => {
      if (!open || !owner) return;
      let stopped = false, timer; const controller = new AbortController();
      const tick = async () => {
        try {
          const data = await api(`terminals?owner=${encodeURIComponent(owner)}&id=${encodeURIComponent(selectedId)}`, undefined, controller.signal);
          if (!stopped) {setItems(data.terminals); setError(''); if (!selectedId && data.terminals.length) setSelectedId(data.terminals.at(-1).id);}
        } catch (error) {if (!stopped) setError(error.message);}
        if (!stopped) timer = setTimeout(tick, 800);
      };
      tick(); return () => {stopped = true; clearTimeout(timer); controller.abort();};
    }, [open, owner, selectedId]);
    useEffect(() => {if (screenRef.current) screenRef.current.scrollTop = screenRef.current.scrollHeight;}, [selected?.screen]);
    useEffect(() => {
      if (open && selectedId && selected?.screen !== undefined) screenRef.current?.focus({preventScroll: true});
    }, [open, selectedId, selected?.screen !== undefined]);
    const write = data => {
      const held = controlRef.current;
      if (!selected || held.id !== selected.id || !held.lease) return Promise.reject(new Error('请先接管输入控制权'));
      if (queuedInput.current >= 256) return Promise.reject(new Error('输入排队已达上限，请等待终端响应'));
      queuedInput.current++;
      const next = inputQueue.current.then(() => {
        if (controlRef.current !== held) throw new Error('输入控制权已改变，未重放排队输入');
        return api('terminal/control', {id: held.id, owner, action: 'input', data, lease: held.lease});
      });
      inputQueue.current = next;
      return next.finally(() => {queuedInput.current--;});
    };
    const act = async (action, extra = {}) => {
      if (!selected) return;
      setBusy(true); setError('');
      try {
        const result = action === 'input' ? await write(extra.data) : await api('terminal/control', {id: selected.id, owner, action, lease: control.lease, ...extra});
        if (action === 'takeover') {const held = {id: result.id, lease: result.lease}; controlRef.current = held; setControl(held); inputQueue.current = Promise.resolve();}
        if (action === 'release') {const held = {id: '', lease: ''}; controlRef.current = held; setControl(held);}
        if (result.id) setItems(items.map(item => item.id === result.id ? result : item));
      } catch (error) {setError(error.message);} finally {setBusy(false);}
    };
    const sendText = async () => {
      if (!input || selected?.control !== 'human') return;
      setBusy(true); setError('');
      try {
        const data = input.replaceAll('\x1b', '').replaceAll('\0', '');
        await write(`\x1b[200~${data}\x1b[201~`); await new Promise(resolve => setTimeout(resolve, 400)); await write('\r'); setInput('');
      } catch (error) {setError(error.message);} finally {setBusy(false);}
    };
    const key = event => {
      if (selected?.control !== 'human' || busy) return;
      const keys = {Enter: '\r', Escape: '\x1b', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Backspace: '\x7f', Tab: '\t'};
      let data = keys[event.key];
      if (event.ctrlKey && event.key.length === 1) data = String.fromCharCode(event.key.toUpperCase().charCodeAt(0) & 31);
      else if (!event.ctrlKey && !event.metaKey && event.key.length === 1) data = event.key;
      if (data) {event.preventDefault(); write(data).catch(error => setError(error.message));}
    };
    return h(React.Fragment, null,
      h('div', {className: 'dsho-agent-terminals'}, h('button', {type: 'button', className: 'dsho-terminal-launch', onClick: () => setOpen(true)}, '子代理终端', h('span', {className: 'hint'}, ' · 弹窗查看 / 人工接管'))),
      h('dialog', {ref: dialogRef, className: 'dsho-terminal-dialog', 'aria-label': '子代理终端',
        onCancel: event => {event.preventDefault(); setOpen(false);}, onClose: () => setOpen(false)},
      h('div', {className: 'dsho-terminal-dialog-head'}, h('strong', null, '子代理终端'),
        h('span', {className: 'hint'}, '关闭窗口不会停止 CLI 或交还控制权'),
        h('button', {type: 'button', 'aria-label': '关闭终端弹窗', onClick: () => setOpen(false)}, '×')),
      open && h('div', {className: 'dsho-terminal-panel'},
        error && h('p', {className: 'dsho-terminal-error', role: 'alert'}, error),
        !items.length ? h('p', {className: 'hint'}, '尚无子代理终端。使用可见 CLI 终端方式运行任务后，会在这里显示。') : h('div', null,
          h('div', {className: 'dsho-terminal-toolbar'},
            h('select', {'aria-label': '选择子代理终端', value: selectedId, onChange: event => setSelectedId(event.target.value)},
              ...items.map(item => h('option', {key: item.id, value: item.id}, `${providerLabel(item.provider)} · ${item.phase} · ${item.title} · ${terminalStatus(item.status)}`))),
            selected && h('span', {className: 'hint'}, terminalClosed ? '终端已结束' : selected.control === 'human' ? '人工控制中' : '编排控制中')),
          selected && h('div', null,
            selected.error && h('p', {className: 'dsho-terminal-error'}, selected.error),
            h('div', {className: 'dsho-terminal-actions'},
              selected.control !== 'human' || control.id !== selected.id ? h('button', {type: 'button', disabled: busy || ['closed', 'exited', 'failed'].includes(selected.status), onClick: () => act('takeover')}, selected.control === 'human' ? '重新接管输入' : '接管并暂停编排') :
              h(React.Fragment, null,
                h('button', {type: 'button', disabled: busy, onClick: () => act('release')}, '交还，保持暂停'),
                h('button', {type: 'button', disabled: busy || runFinished, onClick: () => act('release', {resume: true})}, '交还并继续编排')),
              h('button', {type: 'button', disabled: busy || selected.control !== 'human' || control.id !== selected.id, onClick: () => act('input', {data: '\x03'})}, 'Ctrl+C'),
              h('button', {type: 'button', disabled: busy || selected.control !== 'human' || control.id !== selected.id, onClick: () => act('input', {data: '\r'})}, 'Enter'),
              h('button', {type: 'button', disabled: busy || terminalClosed || selected.status === 'running', onClick: () => act('close')}, '关闭空闲终端')),
            h('pre', {ref: screenRef, className: 'dsho-terminal-screen', tabIndex: 0, role: 'log', 'aria-label': '子代理终端屏幕', onKeyDown: key}, selected.screen || '正在读取终端屏幕…'),
            selected.control === 'human' && control.id === selected.id && h('div', {className: 'dsho-terminal-input'},
              h('textarea', {'aria-label': '发送到子代理 CLI', value: input, placeholder: '输入 CLI 消息；也可点击屏幕直接输入按键', onChange: event => setInput(event.target.value)}),
              h('button', {type: 'button', disabled: busy || !input, onClick: sendText}, '发送并回车'),
              h('p', {className: 'hint'}, '交还会停止当前 CLI 操作并保留原生历史；继续编排后恢复中断阶段。')))))));
  }
  function CallsPage({fixedOwner} = {}) {
    const {data, error} = useOrchestratorData(1000);
    const [view, setView] = useState('branches');
    const runs = (data?.runs ?? []).filter(run => typeof fixedOwner !== 'string' || run.owner === fixedOwner);
    const events = [];
    for (const run of runs) for (const call of run.calls ?? []) {
      const order = events.length, input = call.input || `任务：${call.title || call.taskId}\n旧记录未保存发送正文。`;
      events.push({key: `${call.id}-send`, at: call.startedAt, order, kind: '发出', call, text: input, preview: call.title || call.taskId, truncated: call.inputTruncated});
      if (!['starting', 'running'].includes(call.status)) {
        const kind = {failed: '失败', interrupted: '中断', cancelled: '取消', timed_out: '超时'}[call.status] || '返回';
        const text = call.error || call.output || '未保存返回正文';
        events.push({key: `${call.id}-return`, at: call.endedAt || call.startedAt, order: order + 1, kind, call, text, preview: `${call.status === 'failed' ? '失败 · ' : ''}${text}`, truncated: call.outputTruncated});
      }
    }
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order - b.order);
    const traceCss = `.dsho-trace{width:100%;min-width:0;min-height:0;font:inherit;font-size:13px;line-height:1.6;color:inherit}.dsho-trace table{width:100%;table-layout:fixed;border-collapse:collapse}.dsho-trace td{padding:5px 8px;border-bottom:1px solid #8882;vertical-align:top}.dsho-trace .when{width:76px;opacity:.55;font-size:12px;white-space:nowrap}.dsho-trace .kind{width:46px}.dsho-trace .agent{width:110px;white-space:nowrap}.dsho-trace .badge{display:inline-block;padding:0 5px;border-radius:4px;background:#f2a94018;color:#b27b21}.dsho-trace .returned{background:#29a67b18;color:#28896a}.dsho-trace .attention{background:#f2a94020;color:#a36a17}.dsho-trace .failed{background:#d75b4118;color:#c4543d}.dsho-trace .is-failed td{background:#db404012}.dsho-trace .is-failed td:first-child{border-left:3px solid #d83e3e}.dsho-trace .is-failed .badge{background:#c73535;color:#fff;font-weight:700}.dsho-trace .is-failed summary{color:var(--dsw-alias-label-error,#c84040);font-weight:600}.dsho-trace .phase{opacity:.55;font-size:11px;margin-left:5px}.dsho-trace summary{cursor:pointer;list-style:none}.dsho-trace details[open] summary{white-space:normal}.dsho-trace pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0;max-height:420px;overflow:auto}.dsho-trace .hint{opacity:.55;font-size:12px}.dsho-trace .empty{padding:12px 16px;opacity:.6}.dsho-trace .viewbar{display:flex;align-items:center;gap:6px;padding:8px 0;border-bottom:1px solid #8882}.dsho-trace .viewbar button{padding:4px 9px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}.dsho-trace .viewbar button[aria-pressed=true]{border-color:#657de0;background:#657de018}.dsho-trace .viewbar .hint{margin-left:auto}.dsho-trace .dsho-lanes{display:grid;gap:18px;padding:10px 0}.dsho-trace .dsho-run{border-bottom:1px solid #8882;padding-bottom:16px;min-width:0}.dsho-trace .dsho-run:last-child{border-bottom:0}.dsho-trace .dsho-run-head{display:flex;align-items:center;gap:9px;min-width:0;padding:4px 0 10px}.dsho-trace .dsho-run-state{flex:none;border:1px solid #8885;border-radius:6px;padding:1px 6px;font-size:11px}.dsho-trace .dsho-run-state.is-completed{color:#28896a;border-color:#28896a66}.dsho-trace .dsho-run-state.is-attention{color:#c4543d;border-color:#c4543d66}.dsho-trace .dsho-run-goal{font-weight:600;min-width:0}.dsho-trace .dsho-run-cwd{opacity:.5;font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsho-trace .dsho-run-time{margin-left:auto;flex:none;opacity:.55;font-size:11px}.dsho-trace .dsho-lane-timeline{position:relative;padding:11px 0 2px 17px;min-height:42px}.dsho-trace .dsho-lane-timeline::before{content:'';position:absolute;left:5px;top:12px;bottom:8px;width:1px;background:var(--dsho-lane);opacity:.42}.dsho-trace .dsho-node{position:relative;margin:0 0 7px}.dsho-trace .dsho-node:last-child{margin-bottom:0}.dsho-trace .dsho-node-dot{position:absolute;left:-17px;top:7px;width:9px;height:9px;box-sizing:border-box;border:1.5px solid var(--dsho-lane);border-radius:50%;background:var(--dsw-alias-bg-module-platform,#fff);z-index:1}.dsho-trace .dsho-node.is-returned .dsho-node-dot{background:var(--dsho-lane)}.dsho-trace .dsho-node.is-failed .dsho-node-dot,.dsho-trace .dsho-node.is-abnormal .dsho-node-dot{border-color:#c73535;background:#c73535}.dsho-trace .dsho-node.is-waiting .dsho-node-dot{border-style:dashed;background:transparent}.dsho-trace .dsho-node.is-active .dsho-node-dot{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsho-lane) 20%,transparent);animation:dsho-pulse 1.6s ease-in-out infinite}@keyframes dsho-pulse{50%{box-shadow:0 0 0 6px transparent}}.dsho-trace .dsho-node details{border-radius:6px;padding:4px 6px;background:#8881;min-width:0}.dsho-trace .dsho-node.is-failed details{background:#d83e3e0e;border-left:2px solid #d83e3e;padding-left:6px}.dsho-trace .dsho-node.is-abnormal details{background:#e09a3a0e;border-left:2px solid #d08a31;padding-left:6px}.dsho-trace .dsho-node summary{position:relative;display:grid;gap:2px;min-width:0;overflow:hidden;cursor:pointer;list-style:none;padding-right:13px}.dsho-trace .dsho-node summary::-webkit-details-marker{display:none}.dsho-trace .dsho-node summary::after{content:'›';position:absolute;right:1px;top:50%;transform:translateY(-50%);font-size:14px;line-height:1;opacity:.32}.dsho-trace .dsho-node details[open] summary::after{transform:translateY(-50%) rotate(90deg)}.dsho-trace .dsho-node-head{display:flex;align-items:center;gap:6px;min-width:0}.dsho-trace .dsho-node-head .badge{flex:none;font-size:10px;font-weight:600}.dsho-trace .dsho-node-meta{font-size:10px;opacity:.58;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}.dsho-trace .dsho-node-preview{font-size:11px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.82}.dsho-trace .dsho-node.is-failed .dsho-node-head .badge{background:#c73535;color:#fff;font-weight:700}.dsho-trace .dsho-node.is-failed .dsho-node-preview{color:var(--dsw-alias-label-error,#c84040);font-weight:600}.dsho-trace .dsho-node details[open] .dsho-node-preview{white-space:normal;overflow-wrap:anywhere}.dsho-trace .dsho-node pre{font-size:11px;max-height:260px}.dsho-trace .empty-lane{padding:10px;opacity:.55}@media (prefers-reduced-motion:reduce){.dsho-trace .dsho-node.is-active .dsho-node-dot{animation:none}}.dsho-trace .empty{padding:12px 16px;opacity:.6}`;
    const hasCalls = events.length > 0 || runs.some(run => run.tasks?.length);
    return h('div', {className: 'dsho-trace', 'aria-label': '高级AI记录'}, h('style', null, traceCss + branchCss),
      error && h('div', {role: 'alert', className: 'empty'}, error),
      typeof fixedOwner === 'string' && h(AgentTerminals, {owner: fixedOwner, runs}),
      !data ? h('div', {className: 'empty'}, '正在读取…') : !hasCalls ? h('div', {className: 'empty'}, '当前会话暂无 Agent 调用。') :
      h('div', null,
        h('div', {className: 'viewbar', role: 'group', 'aria-label': '高级AI记录显示方式'},
          h('button', {type: 'button', 'aria-pressed': view === 'branches', onClick: () => setView('branches'), title: '查看 Agent 调用的分出与回接'}, '分支图'),
          h('button', {type: 'button', 'aria-pressed': view === 'time', onClick: () => setView('time')}, '时间顺序'),
          h('span', {className: 'hint'}, view === 'branches' ? '主干向下延伸 · 分派分出，返回回接' : '按调用时间排列')),
        view === 'branches' ? h(BranchView, {runs}) : events.length ? h(TimeView, {events}) : h('div', {className: 'empty'}, '当前运行尚无后端调用。')));
  }
  function Panel() {
    const {data, error, setError, refresh} = useOrchestratorData();
    return h('div', {className: 'dsho-shell'}, h('style', null, css + settingsLayoutCss), h('div', {className: 'dsho'},
      h('h2', null, '多 Agent 编排'),
      error && h('p', {role: 'alert', className: 'dsho-error'}, error),
      !data ? h('p', null, '正在读取编排设置…') : h(Settings, {data, onSaved: refresh, onError: setError})));
  }
  function apply(ctx) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'dsh-orchestrator', order: 45, label: () => '多 Agent 编排'}, Panel));
    ctx.slots.inject('conversation.view', () => ctx.slots.register({name: 'conversation.view', id: 'dsh-orchestrator-calls', order: 30, label: () => '高级AI记录', inject: sessionId => ({orchestratorOwner: () => String(sessionId)})}, props => h(CallsPage, {fixedOwner: props.orchestratorOwner()})));
  }
  return {name: 'local-orchestrator-client', inject: ['slots'], apply};
}});
