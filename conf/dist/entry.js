import { createMapInternal } from 'guide4you/src/main'
import {registerModule} from 'guide4you/src/moduleRegistration'

import 'mustache-eval-loader?name=conf/[name].[ext]!conf/build/client.commented.json'
import 'mustache-eval-loader?name=conf/[name].[ext]!guide4you/conf/dist/layers.commented.json'

import 'tojson-file-loader?name=files/[name]!files/l10n.json.js'

import {SearchModule} from 'src/SearchModule'
import {NominatimSearchConnector} from 'src/NominatimSearchConnector'

registerModule(new SearchModule({ connectors: { nominatim: NominatimSearchConnector } }))

export function createMap (target, clientConf = './conf/client.commented.json',
                           layerConf = './conf/layers.commented.json') {
  return createMapInternal('#g4u-map', clientConf, layerConf)
}

export * from 'guide4you/src/exports'
