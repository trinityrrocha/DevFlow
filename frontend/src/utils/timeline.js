const meaningful = (value) => value && !['Não informado', 'Não se aplica'].includes(value);

export function qaTimelineItems(tests) {
  return [...tests].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).flatMap((test) => {
    const sides = [];
    if (meaningful(test.backend_info)) sides.push({ side: 'backend', componentInfo: test.backend_info });
    if (meaningful(test.frontend_info)) sides.push({ side: 'frontend', componentInfo: test.frontend_info });
    if (!sides.length) sides.push({ side: 'neutral', componentInfo: 'Registro geral' });
    return sides.map((side) => ({ ...test, ...side, timelineId: `${test.id}:${side.side}` }));
  });
}

export function githubTimelineItems(cards) {
  return cards.flatMap((card) => {
    const areas = card.technical_area === 'BACKEND' ? ['backend']
      : card.technical_area === 'FRONTEND' ? ['frontend'] : ['backend', 'frontend'];
    return areas.map((side) => ({ ...card, side, timelineId: `${card.id}:${side}` }));
  });
}

export function attachmentTimelineItems(attachments) {
  return [...attachments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((attachment) => ({
    ...attachment,
    side: attachment.source_section === 'backend' ? 'backend' : attachment.source_section === 'frontend' ? 'frontend' : 'neutral',
    timelineId: attachment.id
  }));
}

export function historyTimelineItems(events, timerEvents = []) {
  return [...events, ...timerEvents.map((event) => ({
    ...event,
    event_type: `TIMER_${event.event_type}`,
    isTimerEvent: true
  }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
