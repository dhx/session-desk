import { defineLegacyOperation } from '../defineOperation'

// Session Desk (#46): the link buttons plugins put in window headers.
export const pluginNodeHeaderStateOperation = defineLegacyOperation({
  id: 'plugin.nodeHeader.state',
  kind: 'query',
  // Asks each plugin backend for its header buttons; runs plugin code.
  scope: 'interact',
  availability: 'always',
  summary: 'Read the header buttons plugins show on canvas windows',
})
