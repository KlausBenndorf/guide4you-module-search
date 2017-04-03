import ol from 'openlayers'
import $ from 'jquery'

import {addTooltip} from 'guide4you/src/html/html'
import {Dropdown} from 'guide4you/src/html/Dropdown'
import {keyCodes} from 'guide4you/src/globals'
import {expandTemplate, addProxy, html2Text} from 'guide4you/src/utilities'
import {Control} from 'guide4you/src/controls/Control'

import {VectorLayer} from 'guide4you/src/layers/VectorLayer'

import {Debug} from 'guide4you/src/Debug'

import 'polyfill!Element.prototype.placeholder'

import '../less/searchcontrol.less'

/**
 * @typedef {g4uControlOptions} SearchControlOptions
 * @property {string} fuzzySearchURL should contain a {searchterm}-placeholder
 * @property {string} exactSearchURL should contain a {searchterm}-placeholder
 * @property {string} autocompleteURL should contain a {searchterm}-placeholder
 * @property {boolean} [useProxy]
 * @property {string} [proxy]
 * @property {number} [amountDropdownEntries=4] number of entries shown in the dropdown
 * @property {number} [autocompleteStart=2] count of letters after which the autocomplete starts
 * @property {number} [autocompleteDelay=300]
 * @property {string} [projectionOfServer=interfaceProjection]
 * @property {number} [slideDuration=400] time it takes for the dropdown to slide down
 * @property {string} [parser] name of the parser to use. At the moment 'Nominatim' is delivered within this module.
 * @property {StyleLike} [style] of the search results
 * @property {boolean} [animated] affects the move to the search results.
 * @property {string} [placeholder] text to be seen in the input field if the user has made no input yet
 * @property {string} [ghostentry] text to be seen in the dropdown if the autocomplete or search didn't find
 * @property {string} [getByIdsURL] should contain a {id<separator>}-placeholder
 *  any matching entries
 * @property {object.<string,SearchParser>} parsers
 * @property {string} [deactivateMobileSearch='exactResult']  other possible values are 'never' and 'anyResult'
 */

const DeactivateMobileSearch = {
  NEVER: 'never',
  ANY: 'anyResult',
  EXACT: 'exactResult'
}

/**
 *
 * @fires 'searchEnd' with bool parameter `success`
 */
export class SearchControl extends Control {
  /**
   * @param {SearchControlOptions} options
   */
  constructor (options) {
    options.className = options.className || 'g4u-search-control'
    options.element = $('<div>').get(0)
    options.singleButton = false

    super(options)

    if (this.getLocaliser().isRtl()) {
      this.get$Element().prop('dir', 'rtl')
    }

    /**
     * @type {boolean}
     * @private
     */
    this.useProxy_ = options.useProxy || (options.hasOwnProperty('useProxy') && options.proxy)

    /**
     * @type {string}
     * @private
     */
    this.proxy_ = options.proxy

    /**
     * @type {string}
     * @private
     */
    this.classNameTextfield_ = this.className_ + '-textfield'

    /**
     * @type {string}
     * @private
     */
    this.classNameSearchbutton_ = this.className_ + '-searchbutton'

    /**
     * @type {number}
     * @private
     */
    this.amountDropdownEntries_ = (options.hasOwnProperty('amountDropdownEntries')) ? options.amountDropdownEntries : 4

    /**
     * @type {number}
     * @private
     */
    this.autocompleteStart_ = (options.hasOwnProperty('autocompleteStart')) ? options.autocompleteStart : 2
    let slideDuration = options.slideDuration || 400

    /**
     * @type {number}
     * @private
     */
    this.autocompleteDelay_ = options.hasOwnProperty('autocompleteDelay') ? options.autocompleteDelay : 300

    if (options.hasOwnProperty('fuzzySearchURL')) {
      /**
       * @type {string}
       * @private
       */
      this.fuzzySearchURL_ = options.fuzzySearchURL
    } else {
      Debug.error('no fuzzySearchURL given for the searchControl!')
    }

    if (options.hasOwnProperty('exactSearchURL')) {
      /**
       * @type {string}
       * @private
       */
      this.exactSearchURL_ = options.exactSearchURL
    } else {
      Debug.error('no exactSearchURL given for the searchControl!')
    }

    /**
     * @type {string}
     * @private
     */
    this.autocompleteURL_ = options.autocompleteURL

    /**
     * @type {string}
     * @private
     */
    this.parserType_ = options.parser

    /**
     * @type {StyleLike}
     * @private
     */
    this.style_ = options.style || {}

    /**
     * @type {boolean}
     * @private
     */
    this.animated_ = options.animated

    /**
     * @type {string}
     * @private
     */
    this.deactivateMobileSearch_ = options.hasOwnProperty('deactivateMobileSearch')
      ? options.deactivateMobileSearch
      : DeactivateMobileSearch.EXACT

    /**
     * @type {string}
     * @private
     */
    this.projectionOfServer_ = options.projectionOfServer

    let placeholder = (options.hasOwnProperty('placeholder'))
      ? this.getLocaliser().selectL10N(options.placeholder)
      : this.getLocaliser().localiseUsingDictionary('SearchControl placeholder')

    /**
     * @type {jQuery}
     * @private
     */
    this.$textfield_ = $('<input autocomplete="off" type="text">')
      .prop('placeholder', placeholder)
      .addClass(this.classNameTextfield_)

    /**
     * @type {jQuery}
     * @private
     */
    this.$submitButton_ = $('<button>')
      .addClass(this.classNameSearchbutton_)
      .text('S')
      .on('click', () => this.onSubmit_())

    addTooltip(this.$submitButton_, this.getLocaliser().localiseUsingDictionary('SearchControl searchButton'))

    /**
     * @type {Dropdown}
     * @private
     */
    this.dropdown_ = new Dropdown({
      ghostentry: options.hasOwnProperty('ghostentry')
        ? options.ghostentry
        : this.getLocaliser().localiseUsingDictionary('SearchControl noSearchResults'),
      slideDuration: slideDuration
    })

    this.dropdown_.on('select', () => this.onDropdownSelect_())

    /**
     * the searchresults are stored as features, even if they don't have coordinates
     * @type {ol.Feature[]}
     * @private
     */
    this.features_ = []

    /**
     * this layer is shown under the normal VectorLayers. Intended for polygons and lines.
     * @type {?VectorLayer}
     * @private
     */
    this.searchlayerBottom_ = null

    /**
     * this layer is shown above the normal VectorLayers. Intended for points.
     * @type {?VectorLayer}
     * @private
     */
    this.searchlayerTop_ = null

    /**
     * @type {boolean}
     * @private
     */
    this.dropdownActive_ = false

    /**
     * @type {Object.<string, SearchParser>}
     * @private
     */
    this.parsers_ = options.parsers

    /**
     * @type {ol.Feature}
     * @private
     */
    this.selectedFeature_ = null

    /**
     * @type {boolean}
     * @private
     */
    this.active_ = false

    this.$textfield_.on('input', e => {
      this.onTextInput_(e)
    })

    // Keyevents in the whole form
    this.get$Element().on('keydown', e => {
      // slide up dropdown
      if (e.which === keyCodes.ESCAPE) {
        this.dropdown_.slideUp()
        $(this.getMap().getViewport()).focus()
      } else if (e.which === keyCodes.ENTER) {
        this.onSubmit_()
      }
    })

    // Keyevents only in the textfields
    this.$textfield_.on('keydown', e => {
      if (e.which === keyCodes.ARROW_DOWN) {
        if (this.dropdown_.isSelectable()) {
          this.dropdown_.focus()
        }
      } else if ((e.which === keyCodes.TAB) && !e.shiftKey) {
        this.dropdown_.slideUp()
      }
    })

    // Keyevents only in the dropdown
    this.dropdown_.on('leave:backwards', e => {
      e.originalEvent.preventDefault()
      this.$textfield_.focus()
    })

    this.dropdown_.on('leave:forwards', e => {
      e.originalEvent.preventDefault()
      this.$submitButton_.focus()
    })

    // Assembling Element
    this.get$Element()
      .append(this.$textfield_)
      .append(this.$submitButton_)
      .append(this.dropdown_.get$Element())

    /**
     * @type {string}
     * @private
     */
    this.getByIdsURL_ = options.getByIdsURL;
  }

  /**
   * @param {?G4UMap} map
   */
  setMap (map) {
    if (this.getMap()) {
      this.getMap().getLayers().remove(this.searchlayerBottom_)
      this.getMap().getLayers().remove(this.searchlayerTop_)
    }
    if (map) {
      // Parser
      if (!this.parsers_.hasOwnProperty(this.parserType_)) {
        Debug.error('No valid parser for searchControl specified! (Option "parser", current value: ' +
          this.parserType_ + ')')
      }

      this.parser_ = new this.parsers_[this.parserType_]({
        featureProjection: map.getView().getProjection(),
        dataProjection: this.projectionOfServer_ || map.get('interfaceProjection'),
        localiser: this.getLocaliser()
      })

      // slide up the dropdown if clicked outside of the searchControl, slide it down if clicked inside

      let slideUp

      document.addEventListener('click', () => {
        if (!map.get('mobile')) {
          slideUp = true
        } else {
          slideUp = false
        }
      }, true)

      $(map.getViewport()).find('.ol-overlaycontainer-stopevent')
        .add(document)
        .on('click', () => {
          if (slideUp) {
            this.setActive(false)
          }
        })

      this.$textfield_.on('click', () => {
        slideUp = false
        this.setActive(true)
      })

      this.searchlayerBottom_ = new VectorLayer({
        source: new ol.source.Vector({
          projection: map.getView().getProjection()
        })
      })
      map.getLayers().insertAt(1, this.searchlayerBottom_)
      map.get('styling').styleLayer(this.searchlayerBottom_, this.style_)

      this.searchlayerTop_ = new VectorLayer({
        source: new ol.source.Vector({
          projection: map.getView().getProjection()
        })
      })
      map.addLayer(this.searchlayerTop_)
      map.get('styling').styleLayer(this.searchlayerTop_, this.style_)
    }
    super.setMap(map)
  }

  /**
   * @param {boolean} active
   */
  setActive (active) {
    let oldValue = this.active_
    if (oldValue !== active) {
      if (active) {
        if (this.dropdownActive_) {
          this.dropdown_.slideDown()
        }
        setTimeout(() => this.$textfield_.focus(), 0)
      } else {
        if (this.dropdownActive_) {
          this.dropdown_.slideUp()
        }
      }

      this.active_ = active
      this.dispatchEvent({
        type: 'change:active',
        oldValue
      })
    }
  }

  getActive () {
    return this.active_
  }

  /**
   * Get the searchresults asynchronously
   * @param {string} searchURL
   * @param {string} searchTerm
   * @returns {Promise}
   * @private
   */
  getSearchResults_ (searchURL, searchTerm) {
    return new Promise((resolve, reject) => {
      let url = expandTemplate(searchURL, 'searchstring', searchTerm) // !

      if (this.useProxy_) {
        url = addProxy(url, this.proxy_ || this.getMap().get('proxy'))
      }

      $.ajax({
        url: url,
        dataType: 'text',
        success: results => {
          this.features_ = this.parser_.parseFeatures(results).slice(0, this.amountDropdownEntries_)
          resolve()
        },
        error: (jqXHR, textStatus) => {
          reject(`Problem while trying to get search results from the Server: ${textStatus} - ${jqXHR.responseText} ` +
            `(SearchURL: ${url})`)
        }
      })
    })
  }

  /**
   * @private
   */
  updateDropdown_ () {
    let inputContainsDropdown = this.selectedFeature_ && (this.features_.length === 1) &&
      (this.features_[0].get('dropdowntext') === this.selectedFeature_.get('dropdowntext'))

    if (inputContainsDropdown || (this.features_.length === 0)) {
      this.dropdownActive_ = false
      return this.dropdown_.slideUp().then(() => this.changed())
    } else {
      let length = Math.min(this.amountDropdownEntries_, this.features_.length)
      let features = this.features_.slice(0, length)
      let texts = features.map(f => f.get('dropdowntext'))

      this.dropdown_.setEntries(features, texts)
      this.dropdownActive_ = true
      return this.dropdown_.slideDown().then(() => this.changed())
    }
  }

  /**
   * @private
   */
  onDropdownSelect_ () {
    let feature = this.dropdown_.getValue()
    this.$textfield_.val(html2Text(feature.get('dropdowntext')))
    this.features_ = [feature]
    this.selectedFeature_ = feature

    if (feature.getGeometry()) {
      this.onSearchEnd_()
    } else {
      this.getSearchResults_(this.exactSearchURL_, encodeURIComponent(feature.get('searchtext')))
        .then(() => this.onSearchEnd_())
    }
  }

  /**
   * @private
   */
  onTextInput_ () {
    this.selectedFeature_ = null
    clearTimeout(this.autocompleteTimeout_)
    this.autocompleteTimeout_ = setTimeout(() => {
      // checking if autocomplete search should be performed and perform it
      let searchtext = encodeURIComponent(this.$textfield_.val())
      if (this.autocompleteURL_ && (searchtext.length >= this.autocompleteStart_)) {
        this.getSearchResults_(this.autocompleteURL_, searchtext)
          .then(() => this.updateDropdown_())
      } else if (this.autocompleteURL_) {
        this.dropdown_.slideUp()
      }
    }, this.autocompleteDelay_)
  }

  /**
    * @private
   */
  onSubmit_ () {
    let searchstring = this.$textfield_.val()

    if (!this.selectedFeature_ ||
        searchstring !== html2Text(this.selectedFeature_.get('dropdowntext'))) {
      searchstring = encodeURIComponent(searchstring)
      this.selectedFeature_ = null
      this.hideSearchlayer_()

      if (searchstring !== '') {
        this.getSearchResults_(this.fuzzySearchURL_, searchstring)
          .then(() => this.onSearchEnd_())
      } else {
        this.features_ = []
        this.hideSearchlayer_()
        this.updateDropdown_()
      }
    }
  }

  onSearchEnd_ () {
    if (this.features_.length > 0) {
      this.showSearchlayer_()

      if (this.features_.length === 1) {
        // exact search result
        if (!this.getMap().get('mobile')) {
          let featurePopup = this.getMap().get('featurePopup')
          featurePopup.setFeature(this.features_[0])
          featurePopup.setVisible(true, false)
          featurePopup.update(false)
          featurePopup.centerMapOnPopup()
        } else {
          if (this.deactivateMobileSearch_ === DeactivateMobileSearch.EXACT) {
            this.centerOnSearchlayer_()
            this.setActive(false)
          }
        }
      } else {
        this.centerOnSearchlayer_()
      }

      if (this.getMap().get('mobile') && this.deactivateMobileSearch_ === DeactivateMobileSearch.ANY) {
        this.centerOnSearchlayer_()
        this.setActive(false)
      }

      this.dispatchEvent({
        type: 'searchEnd',
        success: true,
        searchTerm: this.getSearchValue()
      })
    } else {
      this.dropdown_.showGhostEntry()
      this.dispatchEvent({
        type: 'searchEnd',
        success: false,
        searchTerm: this.getSearchValue()
      })
    }

    this.updateDropdown_().then(() => this.changed())
  }

  /**
   * @returns {Number}
   */
  getAmountResults () {
    return this.features_.length
  }

  /**
   * @returns {string}
   */
  getSearchValue () {
    return encodeURIComponent(this.$textfield_.val())
  }

  /**
   * @private
   */
  showSearchlayer_ () {
    let sourceBottom = this.searchlayerBottom_.getSource()
    sourceBottom.clear()

    let sourceTop = this.searchlayerTop_.getSource()
    sourceTop.clear()

    this.features_.forEach(function (feature) {
      if (feature.getGeometry()) {
        if (feature.getGeometry() instanceof ol.geom.Point || feature.getGeometry() instanceof ol.geom.MultiPoint) {
          sourceTop.addFeature(feature)
        } else {
          sourceBottom.addFeature(feature)
        }
      }
    })

    this.searchlayerBottom_.setVisible(true)
    this.searchlayerTop_.setVisible(true)
  }

  /**
   * @private
   */
  hideSearchlayer_ () {
    if (this.searchlayerBottom_) {
      this.searchlayerBottom_.setVisible(false)
    }

    if (this.searchlayerTop_) {
      this.searchlayerTop_.setVisible(false)
    }
  }

  /**
   * @private
   */
  centerOnSearchlayer_ () {
    if (this.searchlayerBottom_.getVisible()) {
      let extent = ol.extent.extend(
        this.searchlayerBottom_.getSource().getExtent(),
        this.searchlayerTop_.getSource().getExtent()
      )

      if (!ol.extent.isEmpty(extent)) {
        this.getMap().get('move').toExtent(extent, { animated: this.animated_, padding: 'default' })
      }
    }
  }

  getFeatures() {
    return this.features_;
  }
}
