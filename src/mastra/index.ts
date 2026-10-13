import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'

export const mastra = new Mastra({
  storage: new LibSQLStore({ id: 'factory', url: `file:${process.env.INIT_CWD ?? process.cwd()}/factory.db` }),
})
