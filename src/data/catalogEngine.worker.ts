import { expose, transfer } from 'comlink'
import { createIndexedDbCatalogCache } from './catalogCache'
import { CatalogEngine } from './catalogEngine'
import { createCatalogEngineApi } from './catalogEngineApi'

expose(createCatalogEngineApi(new CatalogEngine(createIndexedDbCatalogCache()), transfer))
