// LT-1-T02 — Criação de ocorrência com idempotência e estados da SPEC-1-002
// RN-1-03: obrigatórios; RN-1-01: unidade única; RN-1-02: divergência → exceção;
// CA-1-05: idempotency_key UNIQUE; RN-1-04/05: confirmado só com ID; RN-1-07: multiunidade;
// RN-1-09: timeout → possivel_duplicidade, nunca retry cego.
// RLS: somente autenticados (a matriz F1-T04 aplica-se via regras da collection).

routerAdd('POST', '/backend/v1/ocorrencias/criar', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  const body = e.requestInfo().body || {}
  const sourceSystem = String(body.source_system || '')
  const sourceMeetingId = String(body.source_meeting_id || '')
  const empresa = String(body.empresa || '')

  // LT-1-T06 — RLS por empresa (defesa em profundidade): a empresa pedida deve estar
  // nas empresas_autorizadas do usuário (gestor/admin têm ambas por configuração).
  // JSVM: campos de record via getString/get — nunca propriedade (AP-2026-10-02-1150).
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
      mensagem: 'Você não tem acesso à empresa ' + empresa + '. Registro negado.',
    })
  }
  const occurrenceType = String(body.occurrence_type || '')
  const dataFato = String(body.data_fato || '')
  const horario = String(body.horario || '')
  const titulo = String(body.titulo || '')
  const relato = String(body.relato || '')
  const divergencia = body.divergencia_data === true
  const justificativa = String(body.justificativa || '')

  let portalUnitIds = []
  if (Array.isArray(body.portal_unit_ids)) {
    portalUnitIds = body.portal_unit_ids.map(String).filter((c) => c.length > 0)
  } else if (body.portal_unit_id) {
    portalUnitIds = [String(body.portal_unit_id)]
  }

  // RN-1-03: campo obrigatório ausente → aguardando_correcao (nunca criar)
  const faltando = []
  if (!sourceSystem) faltando.push('source_system')
  if (!sourceMeetingId) faltando.push('source_meeting_id')
  if (portalUnitIds.length === 0) faltando.push('Unidade')
  if (!empresa) faltando.push('Empresa')
  if (!occurrenceType) faltando.push('Tipo')
  if (!dataFato) faltando.push('Data do fato')
  if (!horario) faltando.push('Horário')
  if (!titulo) faltando.push('Título')
  if (!relato) faltando.push('Relato')
  if (divergencia && !justificativa) faltando.push('Justificativa da divergência')
  if (faltando.length > 0) {
    return e.json(200, {
      resultado: 'aguardando_correcao',
      estado: 'aguardando_correcao',
      mensagem: 'Campos obrigatórios ausentes: ' + faltando.join(', '),
    })
  }

  // RN-1-05A (linha vermelha): relato com HTML/script é bloqueado, sem conversão
  if (/<\s*(script|iframe|img|svg|object|embed)/i.test(relato) || /javascript:/i.test(relato)) {
    return e.json(200, {
      resultado: 'aguardando_correcao',
      estado: 'aguardando_correcao',
      mensagem: 'Relato contém conteúdo não permitido (HTML/código). Reescreva em texto simples.',
    })
  }

  // RN-1-07: multiunidade = 1 reunião vinculada a N unidades (uma ocorrência por unidade,
  // todas com a MESMA source_meeting_id e a MESMA data — contabilizadas por unidade)
  const criadas = []
  for (const unitId of portalUnitIds) {
    // CA-1-05: chave persistida ANTES da criação; UNIQUE rejeita reenvio
    const idempotencyKey = $security.sha256(
      sourceSystem + ':' + sourceMeetingId + ':' + unitId + ':' + occurrenceType,
    )

    // Consulta de recuperação local (F1-T06): a mesma chave já existe?
    let existente = null
    try {
      existente = $app.findFirstRecordByFilter('ocorrencias', 'idempotency_key = {:k}', {
        k: idempotencyKey,
      })
    } catch (err) {
      existente = null
    }
    if (existente) {
      if (existente.getString('estado') === 'confirmado') {
        return e.json(200, {
          resultado: 'confirmado',
          id: existente.id,
          estado: 'confirmado',
          mensagem: 'Ocorrência já registrada para esta origem — nenhuma duplicata criada.',
          duplicata: true,
        })
      }
      return e.json(200, {
        resultado: 'inconclusivo',
        estado: existente.getString('estado'),
        mensagem:
          'Já existe registro desta origem sem confirmação (' +
          existente.getString('estado') +
          '). Decisão humana necessária antes de nova escrita.',
      })
    }

    // RN-1-02: divergência de data → aguardando_aprovacao_de_excecao com justificativa
    const estado = divergencia ? 'aguardando_aprovacao_de_excecao' : 'confirmado'

    const col = $app.findCollectionByNameOrId('ocorrencias')
    const rec = new Record(col)
    rec.set('source_system', sourceSystem)
    rec.set('source_meeting_id', sourceMeetingId)
    rec.set('portal_unit_id', unitId)
    rec.set('occurrence_type', occurrenceType)
    rec.set('data_fato', dataFato)
    rec.set('horario', horario)
    rec.set('titulo', titulo)
    rec.set('relato', relato)
    rec.set('estado', estado)
    rec.set('idempotency_key', idempotencyKey)
    rec.set('motivo', divergencia ? 'Divergência de data: ' + justificativa : '')
    rec.set('criado_por', auth.id)
    rec.set('empresa', empresa)
    try {
      $app.save(rec)
    } catch (err) {
      // UNIQUE rejeitou (corrida de reenvio) → tratar como duplicata confirmada ou inconclusivo
      const msg = String(err || '')
      if (msg.indexOf('unique') !== -1 || msg.indexOf('UNIQUE') !== -1) {
        return e.json(200, {
          resultado: 'inconclusivo',
          estado: 'possivel_duplicidade',
          mensagem:
            'Registro desta origem já existe (rejeição de unicidade). Conferir antes de nova escrita.',
        })
      }
      return e.json(200, {
        resultado: 'falha',
        estado: 'falha_de_gravacao',
        mensagem: 'Falha ao gravar a ocorrência. Nada foi confirmado.',
      })
    }
    criadas.push({ id: rec.id, unidade: unitId, estado: estado })
  }

  if (criadas.length === 1) {
    return e.json(200, {
      resultado:
        criadas[0].estado === 'confirmado' ? 'confirmado' : 'aguardando_aprovacao_de_excecao',
      id: criadas[0].id,
      estado: criadas[0].estado,
    })
  }
  // Multiunidade: retorna todos os IDs criados
  return e.json(200, {
    resultado: criadas.every((c) => c.estado === 'confirmado')
      ? 'confirmado'
      : 'aguardando_aprovacao_de_excecao',
    ids: criadas,
    estado: criadas.every((c) => c.estado === 'confirmado')
      ? 'confirmado'
      : 'aguardando_aprovacao_de_excecao',
  })
})
