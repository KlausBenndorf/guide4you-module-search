import ol from 'openlayers'
import $ from 'jquery'
import {zip} from 'lodash/zip'

import {Debug} from 'guide4you/src/Debug'
import {SearchConnector} from './SearchConnector'
import {expandTemplate} from 'guide4you/src/utilities'

export class NominatimSearchConnector extends SearchConnector {
  constructor (options) {
    super(options)

    this.dataProjection = 'EPSG:4326'
  }

  setMap (map) {
    super.setMap(map)

    if (map) {
      let extent = map.getView().calculateExtent(map.getSize())

      let extentString = ol.proj.transformExtent(extent, this.featureProjection, this.dataProjection).join(',')

      this.url_ = this.serviceURL +
        'format=json&q={searchstring}&addressdetails=1&dedupe=1&viewboxlbrt=' + extentString +
        '&bounded=1&extratags=1&namedetails=1'
    }
  }

  getAutoComplete (text) {
    return new Promise(resolve => resolve([[], []]))
  }

  getSearchResult (searchTerm) {
    return new Promise((resolve, reject) => {
      let url = expandTemplate(this.url_, 'searchstring', searchTerm) // !

      $.ajax({
        url: this.proxifyUrl(url),
        dataType: 'json',
        success: results => {
          resolve(zip(...results.map(r => this.readFeature_(r))))
        },
        error: (jqXHR, textStatus) => {
          reject(`Problem while trying to get search results from the Server: ${textStatus} - ${jqXHR.responseText} ` +
            `(SearchURL: ${url})`)
        }
      })
    })
  }

  /**
   * @param {object} data
   * @returns {[string, ol.Feature]}
   * @protected
   */
  readFeature_ (data) {
    Debug.info(data)

    // creates Features which may have the following data fields:
    // id
    // name
    // description
    // dropdowntext
    // searchtext
    //
    // and will have a geometry and a style if anything was provided

    let descriptionArray = []

    /**
     * Pushes an element to the description array
     * @param {string} val
     */
    function pushDescriptionArray (val) {
      if (descriptionArray.length < 1 || val !== descriptionArray[descriptionArray.length - 1]) {
        descriptionArray.push(val)
      }
    }

    let featureOptions = {}
    let id

    if (data.hasOwnProperty('place_id')) {
      id = data.place_id
    }

    if (data.hasOwnProperty('display_name')) {
      featureOptions.searchtext = data.display_name
    }

    if (data.hasOwnProperty('namedetails')) {
      let curLang = this.localiser_.getCurrentLang()
      if (data.namedetails.hasOwnProperty('name:' + curLang)) {
        pushDescriptionArray(data.namedetails['name:' + curLang])
      } else if (data.namedetails.hasOwnProperty('name')) {
        pushDescriptionArray(data.namedetails.name)
      }
    } else {
      throw new Error('Please add the option namedetails=1 to your searchstring in the config.')
    }

    if (data.hasOwnProperty('address')) {
      if (data && data.address.hasOwnProperty('type')) {
        pushDescriptionArray(data.address[data.type])
      } else if (data.type === 'administrative') {
        pushDescriptionArray(data.display_name.split(', ')[0])
      }

      let road
      if (data.address.hasOwnProperty('road')) {
        road = data.address.road
      } else if (data.address.hasOwnProperty('pedestrian')) {
        road = data.address.pedestrian
      } else if (data.address.hasOwnProperty('cycleway')) {
        road = data.address.cycleway
      }

      if (road) {
        if (data.address.hasOwnProperty('house_number')) {
          road += ' ' + data.address.house_number
        }

        pushDescriptionArray(road)
      }

      let postcode
      if (data.address.hasOwnProperty('postcode')) {
        postcode = data.address.postcode
      }

      let city = ''
      if (data.address.hasOwnProperty('city')) {
        city = data.address.city
      } else if (data.address.hasOwnProperty('town')) {
        city = data.address.town
      } else if (data.address.hasOwnProperty('village')) {
        city = data.address.village
      }

      if (postcode && city) {
        pushDescriptionArray(postcode + ' ' + city)
      } else if (postcode) {
        pushDescriptionArray(postcode)
      } else if (city) {
        pushDescriptionArray(city)
      }

      if (data.address && (city !== data.address.hasOwnProperty('county'))) {
        pushDescriptionArray(data.address.county)
      }
    } else {
      throw new Error('Please add the option addressdetails=1 to your searchstring in the config.')
    }

    let dropdowntext = descriptionArray.join(',<br />')
    featureOptions.name = descriptionArray.shift()

    if (data.hasOwnProperty('extratags')) {
      if (data.extratags.hasOwnProperty('website')) {
        let linkText = this.localiser_.localiseUsingDictionary('Nominatim website')
        let url = data.extratags.website
        if (url.slice(0, 7) !== 'http://') {
          url = 'http://' + url
        }
        pushDescriptionArray(`<a href="${url}" target="_blank">${linkText}</a>`)
      }
      if (data.extratags.hasOwnProperty('wikipedia')) {
        let comps = data.extratags.wikipedia.split(':')
        let linkText = this.localiser_.localiseUsingDictionary('Nominatim wikipedia')
        let url = `http://${comps[0]}.wikipedia.org/wiki/${comps[1]}`
        pushDescriptionArray(`<a href="${url}" target="_blank">${linkText}</a>`)
      }
    } else {
      Debug.info('You can add the option extratags=1 to your searchstring in the config.')
    }

    featureOptions.description = descriptionArray.join('<br />')

    if (data.hasOwnProperty('polygonpoints')) {
      let polygonpoints = []
      for (let i = 0, ii = data.polygonpoints.length; i < ii; i++) {
        polygonpoints.push([parseFloat(data.polygonpoints[i][0]), parseFloat(data.polygonpoints[i][1])])
      }
      if (this.featureProjection) {
        ol.proj.transform(polygonpoints, this.dataProjection, this.featureProjection)
      }

      featureOptions.geometry = new ol.geom.Polygon(polygonpoints)
    } else if ((data.hasOwnProperty('lon')) && (data.hasOwnProperty('lat'))) {
      let point = [parseFloat(data.lon), parseFloat(data.lat)]

      if (this.featureProjection) {
        let coords = [parseFloat(data.lon), parseFloat(data.lat)]
        point = ol.proj.transform(coords, this.dataProjection, this.featureProjection)
      }

      featureOptions.geometry = new ol.geom.Point(point)
    }

    let feature = new ol.Feature(featureOptions)

    if (data.hasOwnProperty('icon')) {
      feature.set('iconStyle', data.icon)
    }

    if (id) {
      feature.setId(id)
    }

    return [dropdowntext, feature]
  }
}