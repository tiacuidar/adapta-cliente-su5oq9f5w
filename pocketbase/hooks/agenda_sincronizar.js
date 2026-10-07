// LT-2-T01 — Sincronização intranet→Google Calendar (criação de evento)
// POST /backend/v1/agenda/sincronizar  body: { occurrence_id }
// Regras (sinal 06_notas/sinal-lt2-t01-escrita-google-calendar.md, autorizado 2026-10-07 11:58):
//   - Chamado PELO FRONTEND após confirmação da ocorrência — o registro NUNCA depende do
//     Google (SPEC-1-002 §109). Falha → ocorrência permanece CONFIRMADA + flag
//     nao_sincronizada + erro; retry só por botão (nunca retry cego — RN-1-09).
//   - RLS por empresa (LT-1-T06) + permissão: só o criador da ocorrência ou gestor/admin.
//   - Credencial POR EMPRESA (LT-1-T08): acuidar → GOOGLE_CALENDAR_REFRESH_TOKEN;
//     donahelp → GOOGLE_CALENDAR_REFRESH_TOKEN_DONAH (+ client compartilhado).
//     Renovação on-demand (LT-1-T09) — access token expira ~1h.
//   - Idempotência: google_event_id já gravado → nada a fazer (1 evento por ocorrência).
//   - Marker anti-duplicidade: extendedProperties.private.origem = 'intranet' — a importação
//     (google_agenda_importar.js) pula eventos com esse marker (fecha o furo nos 2 sentidos).
//   - Multiunidade (RN-1-07): 1 evento único; título lista as unidades.
//   - Duração fixa: 1 hora (decisão embutida autorizada).
//   - Escopo de escrita: refresh tokens regenerados com calendar.events (gate do champion;
//     sem isso o Google responde 403 insufficient_permissions — caminho de falha provado).

routerAdd('POST', '/backend/v1/agenda/sincronizar', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  const body = e.requestInfo().body || {}
  const occurrenceId = String(body.occurrence_id || '')
  if (!occurrenceId) {
    return e.json(200, { resultado: 'erro', mensagem: 'occurrence_id é obrigatório.' })
  }

  // Ocorrência: findRecordsByFilter (AP-2026-10-02-1150 — findRecordById aplica RLS da collection)
  let ocs = []
  try {
    ocs = $app.findRecordsByFilter('ocorrencias', 'id = {:id}', 'created', 1, 0, {
      id: occurrenceId,
    })
  } catch (err) {
    ocs = []
  }
  if (ocs.length === 0) {
    return e.json(404, { resultado: 'erro', mensagem: 'Ocorrência não encontrada.' })
  }
  const oc = ocs[0]
  // marca nao_sincronizada + erro (ocorrência permanece confirmada — nunca depende do Google)
  // JSVM: toda a lógica inline no callback (top-level não acessível no callback — QA Skip)
  const marcarErro = (msg) => {
    try {
      oc.set('google_sync_estado', 'nao_sincronizada')
      oc.set('google_sync_erro', msg)
      $app.save(oc)
    } catch (errS) {
      // falha ao marcar não derruba a resposta
    }
  }
  const empresa = oc.getString('empresa') || ''
  const role = auth.getString('role') || 'consultor'
  let autorizadas = []
  try {
    autorizadas = auth.get('empresas_autorizadas') || []
  } catch (err) {
    autorizadas = []
  }
  const veAmbas = role === 'gestor' || role === 'administrador'
  if (!veAmbas && !autorizadas.includes(empresa)) {
    return e.json(403, {
      resultado: 'erro',
      mensagem: 'Você não tem acesso à empresa ' + empresa + '.',
    })
  }

  // Permissão de sync: criador da ocorrência ou gestor/admin
  const criadoPor = oc.getString('criado_por') || ''
  if (!veAmbas && criadoPor !== auth.id) {
    return e.json(403, {
      resultado: 'erro',
      mensagem: 'Somente o criador da ocorrência ou gestor/admin sincronizam.',
    })
  }

  // Idempotência: já sincronizada → nada a fazer
  const eventIdGravado = oc.getString('google_event_id') || ''
  if (eventIdGravado) {
    return e.json(200, {
      resultado: 'ok',
      estado: 'sincronizada',
      google_event_id: eventIdGravado,
      mensagem: 'Ocorrência já sincronizada — nenhuma duplicata criada.',
      ja_sincronizada: true,
    })
  }

  // Dados da ocorrência
  const tipo = oc.getString('occurrence_type') || 'Acompanhamento'
  const dataFato = oc.getString('data_fato') || ''
  const horario = oc.getString('horario') || ''
  const tituloOc = oc.getString('titulo') || ''
  const portalUnitId = oc.getString('portal_unit_id') || ''
  if (!dataFato || !horario) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Ocorrência sem data/hora — impossível criar o evento.',
    })
  }

  // Nome(s) da unidade(s) no título (código oficial; multiunidade lista todas)
  let unidadesTitulo = ''
  if (portalUnitId && portalUnitId !== 'conferencia') {
    unidadesTitulo = portalUnitId
    try {
      const tokenName = empresa === 'acuidar' ? 'ACUIDAR_PORTAL_TOKEN' : 'DONAHELP_PORTAL_TOKEN'
      const urlUnidades =
        empresa === 'acuidar'
          ? 'https://app.acuidarbr.com.br/api/dados/unidades'
          : 'https://app.donahelpbr.com.br/api/dados/unidades'
      const portalToken = $secrets.get(tokenName)
      if (portalToken) {
        const resU = $http.send({
          url: urlUnidades,
          method: 'GET',
          headers: { Authorization: portalToken },
          timeout: 15,
        })
        let parsed = null
        if (resU.json && typeof resU.json === 'object') parsed = resU.json
        else if (resU.body) {
          try {
            parsed = JSON.parse(new TextDecoder().decode(resU.body))
          } catch (err2) {
            parsed = null
          }
        }
        let lista = null
        if (Array.isArray(parsed)) lista = parsed
        else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.dados)) lista = parsed.dados
          else if (Array.isArray(parsed.data)) lista = parsed.data
          else if (Array.isArray(parsed.unidades)) lista = parsed.unidades
        }
        if (lista) {
          const u = lista.find((x) => String(x.codigo || '') === portalUnitId)
          if (u && u.nome) unidadesTitulo = portalUnitId + ' — ' + String(u.nome)
        }
      }
    } catch (errU) {
      // sem nome, usa o código (nunca adivinha — RN-1-19)
    }
  }
  const tituloEvento = tituloOc || tipo
  const descUnidade = unidadesTitulo ? ' | ' + unidadesTitulo : ''

  // Credencial por empresa + renovação on-demand (LT-1-T08/T09)
  const secretRefresh =
    empresa === 'acuidar' ? 'GOOGLE_CALENDAR_REFRESH_TOKEN' : 'GOOGLE_CALENDAR_REFRESH_TOKEN_DONAH'
  const clientId = $secrets.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = $secrets.get('GOOGLE_OAUTH_CLIENT_SECRET')
  const refreshToken = $secrets.get(secretRefresh)
  if (!clientId || !clientSecret || !refreshToken) {
    return e.json(200, {
      resultado: 'credencial_ausente',
      secret: secretRefresh,
      mensagem:
        'Credencial de escrita da empresa ' +
        empresa +
        ' ausente. Grave ' +
        secretRefresh +
        ' (+ client) nos Secrets do Skip — nunca pelo chat.',
    })
  }

  const renovar = () => {
    try {
      const resT = $http.send({
        url: 'https://oauth2.googleapis.com/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          'grant_type=refresh_token&client_id=' +
          encodeURIComponent(clientId) +
          '&client_secret=' +
          encodeURIComponent(clientSecret) +
          '&refresh_token=' +
          encodeURIComponent(refreshToken),
        timeout: 15,
      })
      let parsedT = null
      if (resT.json && typeof resT.json === 'object') parsedT = resT.json
      else if (resT.body) {
        try {
          parsedT = JSON.parse(new TextDecoder().decode(resT.body))
        } catch (errT) {
          parsedT = null
        }
      }
      if (resT.statusCode === 200 && parsedT && parsedT.access_token) {
        return { token: parsedT.access_token }
      }
      return {
        falha: 'renovacao_rejeitada',
        http_status: resT.statusCode,
        erro_google: parsedT && parsedT.error ? parsedT.error : '',
      }
    } catch (errR) {
      return { falha: 'renovacao_falhou' }
    }
  }

  // Evento: data_fato (YYYY-MM-DD) + horario (HH:MM) — duração fixa 1h
  const inicio = dataFato + 'T' + (horario.length === 5 ? horario : horario + ':00') + ':00-03:00'
  const horaFim = (() => {
    const m = horario.match(/^(\d{1,2}):(\d{2})/)
    if (!m) return null
    let h = Number(m[1])
    const min = m[2]
    h = (h + 1) % 24
    return String(h).padStart(2, '0') + ':' + min
  })()
  const fim = horaFim ? dataFato + 'T' + horaFim + ':00-03:00' : null

  const criarEvento = (tokenAcesso) => {
    const payload = {
      summary: tituloEvento + descUnidade,
      description:
        'Reunião registrada na intranet Adapta Cliente (ocorrência ' +
        occurrenceId +
        '). Origem: entrada assistida.',
      start: { dateTime: inicio, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: fim || inicio, timeZone: 'America/Sao_Paulo' },
      extendedProperties: {
        private: { origem: 'intranet', occurrence_id: occurrenceId, empresa: empresa },
      },
    }
    return $http.send({
      url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokenAcesso, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 20,
    })
  }

  // Access token: renovar sempre on-demand (o secret não guarda access token utilizável)
  let tokenAcesso = null
  const r = renovar()
  if (r.falha) {
    const msgErro =
      r.falha === 'renovacao_rejeitada'
        ? 'Renovação do refresh token rejeitada pelo Google (HTTP ' +
          (r.http_status || '?') +
          (r.erro_google ? ' — ' + r.erro_google : '') +
          '). Regenerar ' +
          secretRefresh +
          ' com escopo calendar.events.'
        : 'Falha de rede na renovação do refresh token.'
    marcarErro(msgErro)
    return e.json(200, {
      resultado: 'credencial_expirada',
      mensagem: msgErro,
      google_sync_estado: 'nao_sincronizada',
    })
  }
  tokenAcesso = r.token

  let resG = criarEvento(tokenAcesso)
  if (resG.statusCode === 401) {
    const r2 = renovar()
    if (r2.falha) {
      const msgErro2 = 'Renovação falhou após 401 (HTTP ' + (r2.http_status || '?') + ').'
      marcarErro(msgErro2)
      return e.json(200, {
        resultado: 'credencial_expirada',
        mensagem: msgErro2,
        google_sync_estado: 'nao_sincronizada',
      })
    }
    tokenAcesso = r2.token
    resG = criarEvento(tokenAcesso)
  }

  let parsedG = null
  if (resG.json && typeof resG.json === 'object') parsedG = resG.json
  else if (resG.body) {
    try {
      parsedG = JSON.parse(new TextDecoder().decode(resG.body))
    } catch (errG) {
      parsedG = null
    }
  }

  if (resG.statusCode === 200 || resG.statusCode === 201) {
    const eventId = parsedG && parsedG.id ? String(parsedG.id) : ''
    oc.set('google_event_id', eventId)
    oc.set('google_sync_estado', 'sincronizada')
    oc.set('google_sync_erro', '')
    $app.save(oc)
    return e.json(200, {
      resultado: 'ok',
      estado: 'sincronizada',
      google_event_id: eventId,
      mensagem: 'Evento criado no Google Calendar da empresa ' + empresa + '.',
    })
  }

  // Falha de escrita (403 insufficient_permissions, quota, etc.) — ocorrência INTACTA
  const erroGoogle =
    parsedG && parsedG.error && parsedG.error.message
      ? parsedG.error.message
      : 'HTTP ' + resG.statusCode
  const msgFalha = 'Google Calendar recusou a criação do evento (' + erroGoogle + ').'
  marcarErro(msgFalha)
  return e.json(200, {
    resultado: 'falha_sincronizacao',
    google_sync_estado: 'nao_sincronizada',
    mensagem:
      msgFalha + ' A ocorrência permanece confirmada na intranet; use o botão para tentar de novo.',
    http_status: resG.statusCode,
  })
})
