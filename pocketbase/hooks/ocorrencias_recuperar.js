// F1-T06 — Consulta de recuperação após timeout (SPEC-1-002, BLOQUEIO-F1-002-C)
// Prova os 3 resultados: confirmada / ausente / inconclusivo.
// Regra RN-1-09: timeout/resposta inconclusiva → possivel_duplicidade, NUNCA retry cego.
// Regra CA-1-09: resposta inconclusiva bloqueia nova escrita até consulta ou decisão humana.
//
// Entrada (query): source_system, source_meeting_id, portal_unit_id, occurrence_type
// Saída: { resultado: "confirmada" | "ausente" | "inconclusivo", ocorrência?, motivo }
//
// A chave de idempotência é SHA-256(source_system:source_meeting_id:portal_unit_id:occurrence_type).
// Se qualquer componente faltar, o resultado é "inconclusivo" — a chave não pode ser formada
// (SPEC-1-002: sem um componente, bloquear criação).

routerAdd(
  'GET',
  '/backend/v1/ocorrencias/recuperar',
  (e) => {
    const q = e.requestInfo().query

    const sourceSystem = q.source_system || ''
    const sourceMeetingId = q.source_meeting_id || ''
    const portalUnitId = q.portal_unit_id || ''
    const occurrenceType = q.occurrence_type || ''

    // Componente faltando → chave não pode ser formada → inconclusivo (nunca adivinhar)
    if (!sourceSystem || !sourceMeetingId || !portalUnitId || !occurrenceType) {
      return e.json(200, {
        resultado: 'inconclusivo',
        motivo: 'chave_incompleta',
        detalhe: 'Todos os 4 componentes da chave de idempotência são obrigatórios.',
        faltando: [
          !sourceSystem && 'source_system',
          !sourceMeetingId && 'source_meeting_id',
          !portalUnitId && 'portal_unit_id',
          !occurrenceType && 'occurrence_type',
        ].filter(Boolean),
      })
    }

    const key = $security.sha256(
      sourceSystem + ':' + sourceMeetingId + ':' + portalUnitId + ':' + occurrenceType,
    )

    let records
    try {
      records = $app.findRecordsByFilter(
        'ocorrencias',
        'idempotency_key = {:key}',
        '-created',
        10,
        0,
        { key: key },
      )
    } catch (err) {
      // Falha da consulta → inconclusivo, nunca "confirmado" por suposição
      $app
        .logger()
        .error('consulta de recuperação falhou', 'code', 'consulta_falhou', 'error', String(err))
      return e.json(200, {
        resultado: 'inconclusivo',
        motivo: 'consulta_falhou',
        errorId: $security.randomString(8),
      })
    }

    if (records.length === 0) {
      return e.json(200, {
        resultado: 'ausente',
        motivo: 'nenhuma_ocorrencia_com_esta_chave',
        idempotency_key: key,
        // Ausência confirmada → retomada segura com a MESMA chave é permitida (RN-1-10)
      })
    }

    const rec = records[0]
    const estado = rec.getString('estado')

    if (estado === 'confirmado') {
      // Criação confirmada — exibir comprovante; NUNCA recriar
      return e.json(200, {
        resultado: 'confirmada',
        motivo: 'ocorrencia_confirmada_encontrada',
        idempotency_key: key,
        ocorrência: {
          id: rec.id,
          estado: estado,
          data_fato: rec.getString('data_fato'),
          titulo: rec.getString('titulo'),
          portal_occurrence_id: rec.getString('portal_occurrence_id'),
          created: rec.getString('created'),
        },
      })
    }

    // Existe registro mas NÃO confirmado (possivel_duplicidade, falha_de_gravacao, etc.)
    // → inconclusivo quanto à criação; manter estado explícito, decisão humana
    return e.json(200, {
      resultado: 'inconclusivo',
      motivo: 'registro_nao_confirmado',
      estado_atual: estado,
      idempotency_key: key,
      detalhe: 'Registro existe sem confirmação; manter possivel_duplicidade até decisão humana.',
    })
  },
  $apis.requireAuth(),
)
