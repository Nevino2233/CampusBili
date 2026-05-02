(function() {
  'use strict';

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function formatCount(count) {
    if (!count || isNaN(count)) return '0';
    count = parseInt(count);
    if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿';
    if (count >= 10000) return (count / 10000).toFixed(1) + '万';
    return count.toString();
  }

  function $(selector, parent) {
    return (parent || document).querySelector(selector);
  }

  function $$(selector, parent) {
    return (parent || document).querySelectorAll(selector);
  }

  function initPageLoader() {
    var loader = $('#pageLoader');
    if (!loader) return;
    window.addEventListener('load', function() {
      setTimeout(function() {
        loader.classList.add('fade-out');
        setTimeout(function() { loader.style.display = 'none'; }, 300);
      }, 200);
    });
    setTimeout(function() { loader.style.display = 'none'; }, 3000);
  }

  function initBackToTop() {
    var btn = $('#backToTop');
    if (!btn) return;
    var ticking = false;
    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(function() {
          if (window.pageYOffset > 400) { btn.classList.add('show'); }
          else { btn.classList.remove('show'); }
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
    btn.addEventListener('click', function() { smoothScrollTo(0, 500); });
  }

  var Toast = {
    show: function(message, type, duration) {
      type = type || 'info';
      duration = duration || 3000;
      var container = $('#toastContainer');
      if (!container) return;
      var toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'polite');
      var icons = { success: '\u2713', error: '\u2715', warning: '\u26A0', info: '\u2139' };
      var iconSpan = document.createElement('span');
      iconSpan.className = 'toast-icon';
      iconSpan.textContent = icons[type] || '\u2139';
      var msgSpan = document.createElement('span');
      msgSpan.className = 'toast-message';
      msgSpan.textContent = message || '';
      toast.appendChild(iconSpan);
      toast.appendChild(msgSpan);
      container.appendChild(toast);
      requestAnimationFrame(function() { toast.classList.add('show'); });
      setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
      }, duration);
    }
  };

  function showToast(message, type, duration) {
    if ($('#toastContainer')) { Toast.show(message, type, duration); return; }
    type = type || 'info';
    duration = duration || 3000;
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;color:white;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:all 0.3s ease;max-width:400px;text-align:center;';
    var colors = { success: '#67c23a', error: '#f56c6c', warning: '#e6a23c', info: '#909399' };
    toast.style.backgroundColor = colors[type] || colors.info;
    document.body.appendChild(toast);
    setTimeout(function() { toast.style.opacity = '1'; toast.style.top = '90px'; }, 10);
    setTimeout(function() {
      toast.style.opacity = '0'; toast.style.top = '80px';
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, duration);
  }

  var hotKeywordsCache = null;
  var suggestTimer = null;

  function initSearchSuggestions() {
    var searchInput = $('#searchInput');
    var suggestionsBox = $('#searchSuggestions');
    if (!searchInput || !suggestionsBox) return;

    searchInput.addEventListener('focus', function() {
      if (this.value.trim().length === 0) showHotKeywords();
      else fetchSuggestions(this.value.trim());
    });

    searchInput.addEventListener('input', function() {
      var val = this.value.trim();
      if (suggestTimer) { clearTimeout(suggestTimer); suggestTimer = null; }
      if (val.length === 0) showHotKeywords();
      else suggestTimer = setTimeout(function() { fetchSuggestions(val); }, 300);
    });

    searchInput.addEventListener('keydown', function(e) {
      if (e.keyCode === 27) { hideSuggestions(); this.blur(); }
    });

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.search-box') && !e.target.closest('.search-suggestions')) hideSuggestions();
    });

    function showHotKeywords() {
      if (hotKeywordsCache) { renderHotKeywords(hotKeywordsCache); return; }
      suggestionsBox.innerHTML = '<div class="suggestion-header">热门搜索</div><div class="suggestion-loading">加载中...</div>';
      suggestionsBox.classList.add('show');
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/hot?limit=10', true);
      xhr.timeout = 5000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (data.code === 0 && data.data && data.data.length > 0) { hotKeywordsCache = data.data; renderHotKeywords(data.data); }
            else renderFallbackHot();
          } catch (e) { renderFallbackHot(); }
        } else renderFallbackHot();
      };
      xhr.onerror = function() { renderFallbackHot(); };
      xhr.ontimeout = function() { renderFallbackHot(); };
      xhr.send();
    }

    function renderHotKeywords(list) {
      suggestionsBox.innerHTML = '<div class="suggestion-header">热门搜索</div>';
      var wordTypeLabels = { 4: '新', 5: '热', 6: '梗', 7: '播', 9: '梗', 11: '话题', 12: '独家' };
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var itemEl = document.createElement('a');
        itemEl.className = 'suggestion-item suggestion-hot-item';
        itemEl.href = '/search?keyword=' + encodeURIComponent(item.keyword);
        var rankEl = '<span class="hot-rank rank-' + (i < 3 ? 'top' : 'normal') + '">' + (i + 1) + '</span>';
        var label = wordTypeLabels[item.word_type] || '';
        var labelEl = label ? '<span class="hot-label label-' + item.word_type + '">' + escapeHtml(label) + '</span>' : '';
        var iconEl = '';
        if (item.icon) iconEl = '<img class="hot-icon" src="/image/proxy?url=' + encodeURIComponent(item.icon) + '" onerror="this.style.display=\'none\'">';
        var textSpan = document.createElement('span');
        textSpan.className = 'hot-text';
        textSpan.textContent = item.show_name || item.keyword;
        itemEl.innerHTML = rankEl;
        itemEl.appendChild(textSpan);
        if (labelEl) itemEl.insertAdjacentHTML('beforeend', labelEl);
        if (iconEl) itemEl.insertAdjacentHTML('beforeend', iconEl);
        suggestionsBox.appendChild(itemEl);
      }
      suggestionsBox.classList.add('show');
    }

    function renderFallbackHot() {
      var fallback = ['动画', '音乐', '游戏', '科技', '生活', '搞笑', '美食', '国创'];
      suggestionsBox.innerHTML = '<div class="suggestion-header">热门搜索</div>';
      for (var i = 0; i < fallback.length; i++) {
        var itemEl = document.createElement('a');
        itemEl.className = 'suggestion-item suggestion-hot-item';
        itemEl.href = '/search?keyword=' + encodeURIComponent(fallback[i]);
        itemEl.innerHTML = '<span class="hot-rank rank-' + (i < 3 ? 'top' : 'normal') + '">' + (i + 1) + '</span>';
        var textSpan = document.createElement('span');
        textSpan.className = 'hot-text';
        textSpan.textContent = fallback[i];
        itemEl.appendChild(textSpan);
        suggestionsBox.appendChild(itemEl);
      }
      suggestionsBox.classList.add('show');
    }

    function fetchSuggestions(term) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/suggest?term=' + encodeURIComponent(term), true);
      xhr.timeout = 5000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (data.code === 0 && data.data && data.data.length > 0) renderSuggestions(data.data, term);
            else renderSingleSuggestion(term);
          } catch (e) { renderSingleSuggestion(term); }
        } else renderSingleSuggestion(term);
      };
      xhr.onerror = function() { renderSingleSuggestion(term); };
      xhr.ontimeout = function() { renderSingleSuggestion(term); };
      xhr.send();
    }

    function renderSuggestions(list, term) {
      suggestionsBox.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var itemEl = document.createElement('a');
        itemEl.className = 'suggestion-item suggestion-suggest-item';
        itemEl.href = '/search?keyword=' + encodeURIComponent(item.value);
        itemEl.setAttribute('data-value', item.value);
        itemEl.innerHTML = '<svg class="suggest-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>';
        var textSpan = document.createElement('span');
        textSpan.className = 'suggest-text';
        textSpan.textContent = item.name || item.value;
        itemEl.appendChild(textSpan);
        suggestionsBox.appendChild(itemEl);
      }
      suggestionsBox.classList.add('show');
    }

    function renderSingleSuggestion(term) {
      suggestionsBox.innerHTML = '';
      var itemEl = document.createElement('a');
      itemEl.className = 'suggestion-item suggestion-suggest-item';
      itemEl.href = '/search?keyword=' + encodeURIComponent(term);
      itemEl.innerHTML = '<svg class="suggest-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>';
      var textSpan = document.createElement('span');
      textSpan.className = 'suggest-text';
      textSpan.textContent = term;
      itemEl.appendChild(textSpan);
      suggestionsBox.appendChild(itemEl);
      suggestionsBox.classList.add('show');
    }

    function hideSuggestions() { suggestionsBox.classList.remove('show'); }
  }

  function initSearchBox() {
    var searchForm = $('#searchForm');
    var searchInput = $('#searchInput');
    if (!searchForm || !searchInput) return;
    var urlParams = getQueryParams();
    if (urlParams.keyword && window.location.pathname === '/search') searchInput.value = urlParams.keyword;
    searchForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var keyword = searchInput.value.trim();
      if (!keyword) { showToast('请输入搜索关键词', 'warning'); searchInput.focus(); return; }
      window.location.href = '/search?keyword=' + encodeURIComponent(keyword);
    });
  }

  function initVideoCards() {
    var videoCards = $$('.video-card');
    for (var i = 0; i < videoCards.length; i++) {
      (function(card) {
        if (card.getAttribute('data-bound')) return;
        card.setAttribute('data-bound', 'true');
        card.addEventListener('click', function(e) {
          if (e.target.tagName === 'A') return;
          var bvid = card.getAttribute('data-bvid');
          if (bvid) window.location.href = '/video/' + bvid;
        });
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.addEventListener('keydown', function(e) {
          if (e.keyCode === 13 || e.keyCode === 32) { e.preventDefault(); card.click(); }
        });
      })(videoCards[i]);
    }
  }

  function initRankingTabs() {
    var tabs = $$('.ranking-tab');
    for (var i = 0; i < tabs.length; i++) {
      (function(tab) {
        tab.addEventListener('click', function() {
          var rid = tab.getAttribute('data-rid');
          if (!rid) return;
          for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
          tab.classList.add('active');
          window.location.href = '/ranking?rid=' + rid;
        });
      })(tabs[i]);
    }
  }

  function initPagination() {
    var pageBtns = $$('.page-btn[data-page]');
    for (var i = 0; i < pageBtns.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var page = btn.getAttribute('data-page');
          if (!page) return;
          var currentUrl = window.location.pathname;
          var params = getQueryParams();
          params.page = page;
          window.location.href = currentUrl + '?' + buildQueryString(params);
        });
      })(pageBtns[i]);
    }
  }

  function getQueryParams() {
    var params = {};
    var search = window.location.search.substring(1);
    if (!search) return params;
    var pairs = search.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].split('=');
      if (pair[0]) params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return params;
  }

  function buildQueryString(params) {
    var parts = [];
    for (var key in params) {
      if (params.hasOwnProperty(key)) parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    }
    return parts.join('&');
  }

  function initMobileMenu() {
    var menuBtn = $('#mobileMenuBtn');
    var mobileNav = $('#mobileNav');
    var navOverlay = $('#navOverlay');
    if (!menuBtn || !mobileNav) return;

    if (!navOverlay) {
      navOverlay = document.createElement('div');
      navOverlay.className = 'nav-overlay';
      navOverlay.id = 'navOverlay';
      document.body.appendChild(navOverlay);
    }

    var isOpen = false;
    function closeMenu() {
      isOpen = false;
      menuBtn.classList.remove('active');
      mobileNav.classList.remove('open');
      navOverlay.classList.remove('show');
      document.body.style.overflow = '';
    }
    function toggleMenu() {
      isOpen = !isOpen;
      if (isOpen) {
        menuBtn.classList.add('active');
        mobileNav.classList.add('open');
        navOverlay.classList.add('show');
        document.body.style.overflow = 'hidden';
      } else closeMenu();
    }

    menuBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleMenu(); });
    navOverlay.addEventListener('click', closeMenu);

    var navLinks = $$('.mobile-nav-link', mobileNav);
    for (var i = 0; i < navLinks.length; i++) {
      (function(link) { link.addEventListener('click', function() { setTimeout(closeMenu, 150); }); })(navLinks[i]);
    }

    highlightMobileNavLink();
    document.addEventListener('keydown', function(e) { if (e.keyCode === 27 && isOpen) closeMenu(); });
  }

  function highlightMobileNavLink() {
    var path = window.location.pathname;
    var links = $$('.mobile-nav-link');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.getAttribute('href');
      if ((path === '/' && href === '/') ||
          (path.startsWith('/search') && href === '/search') ||
          (path.startsWith('/ranking') && href === '/ranking') ||
          (path.startsWith('/recommend') && href === '/recommend') ||
          (path.startsWith('/dynamic') && href === '/dynamic') ||
          (path.startsWith('/auth/profile') && href === '/auth/profile')) {
        link.classList.add('active');
      }
    }
  }

  function initImageLazyLoad() {
    var videoCovers = $$('.video-cover');
    for (var i = 0; i < videoCovers.length; i++) {
      (function(cover) {
        var img = $('img', cover);
        if (!img) return;
        if (img.complete && img.naturalWidth > 0) { img.classList.add('loaded'); return; }
        var skeleton = document.createElement('div');
        skeleton.className = 'img-skeleton';
        cover.insertBefore(skeleton, img);
        img.addEventListener('load', function() {
          img.classList.add('loaded');
          if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
        });
        img.addEventListener('error', function() {
          img.classList.add('loaded');
          handleImageError(img);
          if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
        });
      })(videoCovers[i]);
    }
  }

  function initLazyImages() {
    var images = $$('img[data-src]');
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            var img = entries[i].target;
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            observer.unobserve(img);
          }
        }
      }, { rootMargin: '50px' });
      for (var j = 0; j < images.length; j++) observer.observe(images[j]);
    } else {
      function lazyLoad() {
        for (var k = 0; k < images.length; k++) {
          var img = images[k];
          if (img.getAttribute('data-src') && isElementInViewport(img)) {
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
          }
        }
      }
      window.addEventListener('scroll', lazyLoad);
      lazyLoad();
    }
    addImageLoadingState();
  }

  function addImageLoadingState() {
    var selectors = ['.video-cover img', '.ranking-cover img', '.recommend-cover img', '.card-cover img', '.uploader-avatar', '.uploader-avatar-large'];
    for (var s = 0; s < selectors.length; s++) {
      var images = $$(selectors[s]);
      for (var i = 0; i < images.length; i++) {
        (function(img) {
          if (!img.complete) {
            var wrapper = img.parentElement;
            if (wrapper) wrapper.classList.add('img-loading');
            img.addEventListener('load', function() {
              if (wrapper) wrapper.classList.remove('img-loading');
              img.classList.add('img-loaded');
            });
            img.addEventListener('error', function() {
              if (wrapper) wrapper.classList.remove('img-loading');
              img.classList.add('img-error');
            });
          }
        })(images[i]);
      }
    }
  }

  function isElementInViewport(el) {
    var rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < (window.innerHeight || document.documentElement.clientHeight) && rect.left < (window.innerWidth || document.documentElement.clientWidth);
  }

  function handleImageError(img) {
    if (!img || img.dataset.errorHandled) return;
    img.dataset.errorHandled = 'true';
    img.style.opacity = '0.3';
    img.style.background = '#1a1a2e';
    img.alt = '图片加载失败';
  }

  function initImageErrorHandler() {
    var images = $$('img');
    for (var i = 0; i < images.length; i++) {
      (function(img) {
        img.addEventListener('error', function() { handleImageError(img); });
        if (img.complete && img.naturalWidth === 0) handleImageError(img);
      })(images[i]);
    }
  }

  function showLoading(container) {
    if (!container) return;
    var loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-spinner';
    loadingDiv.innerHTML = '<div class="spinner"></div>';
    container.appendChild(loadingDiv);
  }

  function hideLoading(container) {
    if (!container) return;
    var spinner = $('.loading-spinner', container);
    if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
  }

  function showEmptyState(container, message, hint) {
    if (!container) return;
    var emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state empty-state-enhanced';
    emptyDiv.innerHTML =
      '<div class="empty-state-illustration"><span class="empty-icon-large">&#128196;</span></div>' +
      '<p class="empty-state-text">' + escapeHtml(message || '暂无数据') + '</p>' +
      '<p class="empty-state-hint">' + escapeHtml(hint || '请稍后再试') + '</p>';
    container.appendChild(emptyDiv);
  }

  function smoothScrollTo(targetY, duration) {
    duration = duration || 500;
    var startY = window.pageYOffset;
    var distance = targetY - startY;
    var startTime = null;
    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var easeProgress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      window.scrollTo(0, startY + distance * easeProgress);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var xgPlayerInstance = null;

  function initVideoPlayer() {
    var container = $('#xgPlayerContainer');
    if (!container) return;
    if (typeof Player === 'undefined') { initFallbackPlayer(); return; }
    var playUrlEl = $('#videoPlayUrl');
    var posterEl = $('#videoPoster');
    var bvidEl = $('#videoBvid');
    var cidEl = $('#videoCid');
    if (!playUrlEl || !playUrlEl.value) return;

    var playUrl = playUrlEl.value;
    var poster = posterEl ? posterEl.value : '';
    var bvid = bvidEl ? bvidEl.value : '';
    var cid = cidEl ? cidEl.value : '';

    var qualityList = [];
    if (window.videoPageData && window.videoPageData.qualityList) {
      qualityList = window.videoPageData.qualityList.map(function(q) {
        return { name: q.quality + (q.width && q.height ? ' (' + q.width + 'x' + q.height + ')' : ''), url: decodeURIComponent(q.url), id: q.id };
      });
    }

    var definitionList = qualityList.length > 1 ? qualityList.map(function(q) {
      return { name: q.name, url: q.url, definition: q.id };
    }) : undefined;

    var playerConfig = {
      id: 'xgPlayerContainer',
      url: playUrl,
      poster: poster,
      fluid: true,
      aspectRatio: '16:9',
      volume: 0,
      autoplay: false,
      preloadTime: 60,
      videoInit: true,
      playbackRate: [0.5, 0.75, 1, 1.5, 2],
      defaultPlaybackRate: 1,
      screenShot: false,
      pip: false,
      download: false,
      keyShortcut: 'on',
      lang: 'zh-cn',
      closeVideoClick: false,
      closeVideoDblClick: false,
      cssFullscreen: true,
      useCssFullscreen: function() { return true; },
      rotateFullscreen: false,
      playsinline: true,
      'x5-video-player-type': 'h5',
      'x5-video-player-fullscreen': false,
      mini: true,
      isShowIcon: true,
      isScrollSwitch: true,
      mobile: { disableGesture: false, gestureX: true, gestureY: true, pressRate: 2, darkness: true, maxDarkness: 0.6, scopeL: 0.25, scopeR: 0.25 },
      minBufferDuration: 30,
      maxBufferDuration: 60,
      bufferBehind: 30,
      ignores: ['download', 'screenShot', 'pip', 'fullscreen']
    };

    if (definitionList && definitionList.length > 0) playerConfig.definition = { list: definitionList };

    try {
      xgPlayerInstance = new Player(playerConfig);

      xgPlayerInstance.on('ready', function() {
        restoreXgPlayProgress(bvid, cid);
        initCustomCssFullscreenBtn();
      });

      var lastProgressSave = 0;
      xgPlayerInstance.on('timeupdate', function() {
        var now = Date.now();
        if (now - lastProgressSave >= 5000) {
          lastProgressSave = now;
          savePlayProgress(bvid, xgPlayerInstance.currentTime, xgPlayerInstance.duration);
        }
      });

      xgPlayerInstance.on('ended', function() {});

      xgPlayerInstance.on('error', function(err) {
        if (xgPlayerInstance.retryCount === undefined) xgPlayerInstance.retryCount = 0;
        if (xgPlayerInstance.retryCount < 2) {
          xgPlayerInstance.retryCount++;
          showToast('视频加载出错，正在重试...', 'warning');
          setTimeout(function() {
            try { xgPlayerInstance.src = playUrl; xgPlayerInstance.play(); }
            catch(e) { showToast('视频播放出错，请刷新页面重试', 'error'); }
          }, 1500);
        } else {
          showToast('视频播放出错，请刷新页面重试', 'error');
        }
      });

      xgPlayerInstance.on('definitionChange', function(data) {
        if (data && data.to) showToast('已切换到 ' + (data.to.name || '新清晰度'), 'success');
      });

      initXgKeyboardShortcuts();
      loadRecommendVideos();

    } catch (e) {
      showToast('播放器初始化失败', 'error');
      initFallbackPlayer();
    }
  }

  function initCustomCssFullscreenBtn() {
    if (!xgPlayerInstance) return;
    var wrapper = document.getElementById('playerWrapper');
    if (!wrapper) return;
    var existingBtn = wrapper.querySelector('.custom-cssfullscreen-btn');
    if (existingBtn) return;

    var btn = document.createElement('div');
    btn.className = 'custom-cssfullscreen-btn';
    btn.innerHTML = '<svg class="icon-enter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
      + '<svg class="icon-exit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>';

    function toggleCssFullscreen(e) {
      e.stopPropagation();
      e.preventDefault();
      if (!xgPlayerInstance) return;
      try {
        if (xgPlayerInstance.cssfullscreen) xgPlayerInstance.exitCssFullscreen();
        else xgPlayerInstance.getCssFullscreen();
      } catch(err) { toggleCssFullscreenManual(); }
    }

    btn.addEventListener('click', toggleCssFullscreen);
    btn.addEventListener('touchend', toggleCssFullscreen);
    wrapper.appendChild(btn);

    xgPlayerInstance.on('cssFullscreen_change', function(isFullscreen) { updateCssFullscreenBtnState(btn, isFullscreen); });
    var playerEl = wrapper.querySelector('.xgplayer');
    if (playerEl && playerEl.classList.contains('xgplayer-is-cssfullscreen')) updateCssFullscreenBtnState(btn, true);
  }

  function toggleCssFullscreenManual() {
    var wrapper = document.getElementById('playerWrapper');
    if (!wrapper) return;
    var playerEl = wrapper.querySelector('.xgplayer');
    if (!playerEl) return;
    var btn = wrapper.querySelector('.custom-cssfullscreen-btn');
    if (playerEl.classList.contains('xgplayer-is-cssfullscreen')) {
      playerEl.classList.remove('xgplayer-is-cssfullscreen');
      if (xgPlayerInstance) xgPlayerInstance.cssfullscreen = false;
      if (btn) updateCssFullscreenBtnState(btn, false);
    } else {
      playerEl.classList.add('xgplayer-is-cssfullscreen');
      if (xgPlayerInstance) xgPlayerInstance.cssfullscreen = true;
      if (btn) updateCssFullscreenBtnState(btn, true);
    }
  }

  function updateCssFullscreenBtnState(btn, isFullscreen) {
    var enterIcon = btn.querySelector('.icon-enter');
    var exitIcon = btn.querySelector('.icon-exit');
    if (isFullscreen) {
      if (enterIcon) enterIcon.style.display = 'none';
      if (exitIcon) exitIcon.style.display = 'block';
      btn.classList.add('is-fullscreen');
      btn.style.position = 'fixed';
      btn.style.top = '16px';
      btn.style.right = '16px';
      btn.style.zIndex = '100001';
      btn.style.width = '40px';
      btn.style.height = '40px';
      btn.style.opacity = '0.8';
    } else {
      if (enterIcon) enterIcon.style.display = 'block';
      if (exitIcon) exitIcon.style.display = 'none';
      btn.classList.remove('is-fullscreen');
      btn.style.position = '';
      btn.style.top = '';
      btn.style.right = '';
      btn.style.zIndex = '';
      btn.style.width = '';
      btn.style.height = '';
      btn.style.opacity = '';
    }
  }

  function initFallbackPlayer() {
    var container = $('#xgPlayerContainer');
    if (!container) return;
    var playUrlEl = $('#videoPlayUrl');
    var posterEl = $('#videoPoster');
    if (!playUrlEl || !playUrlEl.value) return;

    var video = document.createElement('video');
    video.id = 'videoPlayer';
    video.className = 'video-element';
    video.controls = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.poster = posterEl ? posterEl.value : '';
    video.src = playUrlEl.value;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.backgroundColor = '#000';
    container.innerHTML = '';
    container.appendChild(video);

    var bvidEl = $('#videoBvid');
    var bvid = bvidEl ? bvidEl.value : '';
    if (bvid) {
      restorePlayProgress(video);
      var lastProgressSave = 0;
      video.addEventListener('timeupdate', function() {
        var now = Date.now();
        if (now - lastProgressSave >= 5000) {
          lastProgressSave = now;
          savePlayProgress(bvid, video.currentTime, video.duration);
        }
      });
    }

    loadRecommendVideos();
  }

  var _xgKeyboardBound = false;
  function initXgKeyboardShortcuts() {
    if (_xgKeyboardBound) return;
    _xgKeyboardBound = true;
    document.addEventListener('keydown', function(e) {
      if (!xgPlayerInstance) return;
      var activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      switch (e.keyCode) {
        case 32: e.preventDefault(); if (xgPlayerInstance.paused) xgPlayerInstance.play(); else xgPlayerInstance.pause(); break;
        case 37: e.preventDefault(); xgPlayerInstance.currentTime = Math.max(0, xgPlayerInstance.currentTime - 10); break;
        case 39: e.preventDefault(); xgPlayerInstance.currentTime += 10; break;
        case 38: e.preventDefault(); xgPlayerInstance.volume = Math.min(1, xgPlayerInstance.volume + 0.1); break;
        case 40: e.preventDefault(); xgPlayerInstance.volume = Math.max(0, xgPlayerInstance.volume - 0.1); break;
        case 77: e.preventDefault(); xgPlayerInstance.muted = !xgPlayerInstance.muted; break;
      }
    });
  }

  function restoreXgPlayProgress(bvid, cid) {
    if (!xgPlayerInstance || !bvid) return;
    try {
      var key = 'video_progress_' + bvid + '_' + cid;
      var saved = localStorage.getItem(key);
      if (saved) {
        var progress = JSON.parse(saved);
        var oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (progress.timestamp > oneWeekAgo && progress.currentTime > 0) {
          if (progress.duration && progress.currentTime / progress.duration > 0.9) return;
          xgPlayerInstance.currentTime = progress.currentTime;
        }
      }
    } catch (e) {}
  }

  function initVideoRetry() {
    var placeholder = $('#playerPlaceholder');
    if (!placeholder) return;
    var retryBtn = placeholder.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function() {
        this.textContent = '正在重新加载...';
        this.disabled = true;
        setTimeout(function() { location.reload(); }, 500);
      });
    }
  }

  function loadRecommendVideos() {
    var recommendList = $('#recommendList');
    if (!recommendList) return;
    if (recommendList.querySelectorAll('.recommend-item').length > 0) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/popular?ps=10', true);
    xhr.timeout = 5000;
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.code === 0 && data.data && data.data.list) renderRecommendList(data.data.list.slice(0, 8));
          else showRecommendError(recommendList);
        } catch (e) { showRecommendError(recommendList); }
      } else showRecommendError(recommendList);
    };
    xhr.onerror = function() { showRecommendError(recommendList); };
    xhr.ontimeout = function() { showRecommendError(recommendList); };
    xhr.send();
  }

  function createRecommendItem(video) {
    var item = document.createElement('a');
    item.href = '/video/' + (video.bvid || '');
    item.className = 'recommend-item';
    var coverDiv = document.createElement('div');
    coverDiv.className = 'recommend-cover';
    var img = document.createElement('img');
    img.src = '/image/proxy?url=' + encodeURIComponent(video.pic || '');
    img.alt = video.title || '';
    img.loading = 'lazy';
    img.addEventListener('error', function() { handleImageError(img); });
    coverDiv.appendChild(img);
    var infoDiv = document.createElement('div');
    infoDiv.className = 'recommend-info';
    var titleEl = document.createElement('h4');
    titleEl.className = 'recommend-title';
    titleEl.textContent = video.title || '未知标题';
    var metaDiv = document.createElement('div');
    metaDiv.className = 'recommend-meta';
    var upSpan = document.createElement('span');
    upSpan.textContent = 'UP: ' + (video.owner ? video.owner.name : '未知');
    var viewSpan = document.createElement('span');
    viewSpan.textContent = formatCount(video.stat ? video.stat.view : 0) + ' 播放';
    metaDiv.appendChild(upSpan);
    metaDiv.appendChild(viewSpan);
    infoDiv.appendChild(titleEl);
    infoDiv.appendChild(metaDiv);
    item.appendChild(coverDiv);
    item.appendChild(infoDiv);
    return item;
  }

  function renderRecommendList(videos) {
    var recommendList = $('#recommendList');
    if (!recommendList || !videos || videos.length === 0) return;
    recommendList.innerHTML = '';
    for (var i = 0; i < videos.length; i++) recommendList.appendChild(createRecommendItem(videos[i]));
  }

  window.loadMoreRecommend = function() {
    var recommendList = $('#recommendList');
    if (!recommendList) return;
    var loadMoreBtn = $('#loadMoreRecommendBtn');
    if (loadMoreBtn) { loadMoreBtn.textContent = '加载中...'; loadMoreBtn.disabled = true; }
    var currentCount = recommendList.querySelectorAll('.recommend-item').length;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/popular?ps=8&pn=' + Math.ceil(currentCount / 8 + 1), true);
    xhr.timeout = 5000;
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.code === 0 && data.data && data.data.list && data.data.list.length > 0) {
            appendRecommendList(data.data.list);
            showToast('已加载更多推荐', 'success');
          } else {
            showToast('没有更多推荐了', 'info');
            if (loadMoreBtn) { loadMoreBtn.textContent = '已加载全部'; loadMoreBtn.disabled = true; }
          }
        } catch (e) {
          showToast('加载失败，请稍后重试', 'error');
          if (loadMoreBtn) { loadMoreBtn.textContent = '加载更多推荐'; loadMoreBtn.disabled = false; }
        }
      } else {
        showToast('加载失败，请稍后重试', 'error');
        if (loadMoreBtn) { loadMoreBtn.textContent = '加载更多推荐'; loadMoreBtn.disabled = false; }
      }
    };
    xhr.onerror = function() {
      showToast('网络错误，请检查连接', 'error');
      if (loadMoreBtn) { loadMoreBtn.textContent = '加载更多推荐'; loadMoreBtn.disabled = false; }
    };
    xhr.send();
  };

  function appendRecommendList(videos) {
    var recommendList = $('#recommendList');
    var loadMoreBtn = $('#loadMoreRecommendBtn');
    if (!recommendList || !videos || videos.length === 0) return;
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < videos.length; i++) fragment.appendChild(createRecommendItem(videos[i]));
    if (loadMoreBtn) { recommendList.insertBefore(fragment, loadMoreBtn); loadMoreBtn.textContent = '加载更多推荐'; loadMoreBtn.disabled = false; }
    else recommendList.appendChild(fragment);
  }

  function showRecommendError(container) {
    if (!container) return;
    container.innerHTML = '<div class="empty-recommend">暂时无法加载推荐视频</div>';
  }

  function savePlayProgress(videoOrBvid, currentTime, duration) {
    var bvid, time, dur;
    if (typeof videoOrBvid === 'object') {
      if (!videoOrBvid || !window.videoPageData || !window.videoPageData.bvid) return;
      bvid = window.videoPageData.bvid;
      time = videoOrBvid.currentTime;
      dur = videoOrBvid.duration;
    } else {
      bvid = videoOrBvid;
      time = currentTime;
      dur = duration;
    }
    try {
      var key = 'video_progress_' + bvid + '_' + (window.videoPageData ? window.videoPageData.cid : '');
      localStorage.setItem(key, JSON.stringify({ currentTime: time, duration: dur, timestamp: Date.now() }));
    } catch (e) {}
  }

  function restorePlayProgress(video) {
    if (!video || !window.videoPageData || !window.videoPageData.bvid) return;
    try {
      var key = 'video_progress_' + window.videoPageData.bvid + '_' + window.videoPageData.cid;
      var saved = localStorage.getItem(key);
      if (saved) {
        var progress = JSON.parse(saved);
        var oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (progress.timestamp > oneWeekAgo && progress.currentTime > 0) {
          video.addEventListener('loadedmetadata', function onLoaded() {
            video.removeEventListener('loadedmetadata', onLoaded);
            if (progress.duration && progress.currentTime / progress.duration > 0.9) return;
            video.currentTime = progress.currentTime;
          });
        }
      }
    } catch (e) {}
  }

  function initDescriptionToggle() {
    var descContent = $('#descriptionContent');
    var descSection = $('.video-description-section');
    if (!descContent || !descSection) return;
    if (descContent.scrollHeight > 100) {
      descContent.classList.add('collapsed');
      var toggleBtn = document.createElement('button');
      toggleBtn.className = 'desc-toggle-btn';
      toggleBtn.textContent = '展开';
      toggleBtn.addEventListener('click', function() {
        if (descContent.classList.contains('collapsed')) { descContent.classList.remove('collapsed'); toggleBtn.textContent = '收起'; }
        else { descContent.classList.add('collapsed'); toggleBtn.textContent = '展开'; }
      });
      descSection.appendChild(toggleBtn);
    }
  }

  function highlightNav() {
    var path = window.location.pathname;
    var navLinks = $$('.nav-link');
    for (var i = 0; i < navLinks.length; i++) {
      var link = navLinks[i];
      var href = link.getAttribute('href');
      link.classList.remove('active');
      if ((path === '/' && href === '/') ||
          (path.startsWith('/search') && href === '/search') ||
          (path.startsWith('/ranking') && href === '/ranking') ||
          (path.startsWith('/recommend') && href === '/recommend') ||
          (path.startsWith('/dynamic') && href === '/dynamic')) {
        link.classList.add('active');
      }
    }
  }

  function initComments() {
    var sortBtns = $$('.sort-btn');
    var commentsSection = document.getElementById('commentsSection');
    if (!commentsSection || sortBtns.length === 0) return;
    for (var i = 0; i < sortBtns.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var sort = this.getAttribute('data-sort');
          for (var j = 0; j < sortBtns.length; j++) sortBtns[j].classList.remove('active');
          this.classList.add('active');
          showToast(sort === '0' ? '已切换为按时间排序' : '已切换为按热度排序');
        });
      })(sortBtns[i]);
    }
    var replyToggles = $$('.comment-reply-toggle');
    for (var k = 0; k < replyToggles.length; k++) {
      (function(toggle) {
        toggle.addEventListener('click', function() {
          var commentItem = this.closest('.comment-item');
          if (!commentItem) return;
          var repliesContainer = commentItem.querySelector('.comment-replies');
          if (!repliesContainer) return;
          if (repliesContainer.style.display === 'none') { repliesContainer.style.display = ''; this.textContent = this.textContent.replace('\u25BE', '\u25B4'); }
          else { repliesContainer.style.display = 'none'; this.textContent = this.textContent.replace('\u25B4', '\u25BE'); }
        });
      })(replyToggles[k]);
    }
  }

  function initRelatedSlider() {
    var relatedSection = document.querySelector('.related-section');
    if (!relatedSection) return;
    var relatedGrid = relatedSection.querySelector('.related-grid, .video-grid');
    if (!relatedGrid) return;
    function isMobile() { return window.innerWidth <= 768; }
    function applyMobileLayout() {
      relatedGrid.style.overflowX = 'auto';
      relatedGrid.style.overflowY = 'hidden';
      relatedGrid.style.webkitOverflowScrolling = 'touch';
      relatedGrid.style.flexWrap = 'nowrap';
      var cards = relatedGrid.querySelectorAll('.video-card');
      for (var i = 0; i < cards.length; i++) { cards[i].style.flexShrink = '0'; cards[i].style.width = '200px'; }
    }
    function resetLayout() {
      relatedGrid.style.overflowX = '';
      relatedGrid.style.overflowY = '';
      relatedGrid.style.webkitOverflowScrolling = '';
      relatedGrid.style.flexWrap = '';
      var cards = relatedGrid.querySelectorAll('.video-card');
      for (var i = 0; i < cards.length; i++) { cards[i].style.flexShrink = ''; cards[i].style.width = ''; }
    }
    if (isMobile()) applyMobileLayout();
    var resizeTimer = null;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() { if (isMobile()) applyMobileLayout(); else resetLayout(); }, 150);
    });
  }

  function initSpaceLinks() {
    var ownerLinks = $$('.owner-name, .uploader-name');
    for (var i = 0; i < ownerLinks.length; i++) {
      (function(link) {
        link.style.cursor = 'pointer';
        link.addEventListener('click', function(e) {
          e.preventDefault();
          var mid = this.getAttribute('data-mid');
          if (mid) window.location.href = '/space/' + mid;
        });
      })(ownerLinks[i]);
    }
    var ownerAvatars = $$('.owner-avatar, .uploader-avatar, .uploader-avatar-large');
    for (var j = 0; j < ownerAvatars.length; j++) {
      (function(avatar) {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var mid = this.getAttribute('data-mid');
          if (mid) window.location.href = '/space/' + mid;
        });
      })(ownerAvatars[j]);
    }
    var commentNames = $$('.comment-name');
    for (var k = 0; k < commentNames.length; k++) {
      (function(nameEl) {
        nameEl.addEventListener('click', function() {
          var mid = this.getAttribute('data-mid');
          if (mid) window.location.href = '/space/' + mid;
        });
      })(commentNames[k]);
    }
  }

  function initHeaderScroll() {
    var header = document.getElementById('siteHeader');
    if (!header) return;
    var ticking = false;
    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(function() {
          if (window.pageYOffset > 10) header.classList.add('scrolled');
          else header.classList.remove('scrolled');
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  function initUserDropdown() {
    var userEntry = document.getElementById('userEntry');
    var userDropdown = document.getElementById('userDropdown');
    var logoutBtn = document.getElementById('logoutBtn');
    if (!userEntry || !userDropdown) return;

    document.addEventListener('click', function(e) {
      if (userEntry.contains(e.target)) return;
      userEntry.classList.remove('open');
    });

    var userEntryLink = document.getElementById('userEntryLink');
    if (userEntryLink) {
      userEntryLink.addEventListener('click', function(e) {
        e.preventDefault();
        userEntry.classList.toggle('open');
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        fetch('/auth/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          .then(function(res) { return res.json(); })
          .then(function(res) { if (res.code === 0) window.location.href = '/auth/login'; })
          .catch(function() { window.location.href = '/auth/login'; });
      });
    }

    var isLoggedIn = window.CampusBiliApp && window.CampusBiliApp.isLoggedIn;
    var currentUser = window.CampusBiliApp && window.CampusBiliApp.currentUser;
    var dropdownName = document.getElementById('userDropdownName');
    var dropdownLevel = document.getElementById('userDropdownLevel');
    var dropdownAvatar = document.getElementById('userDropdownAvatar');

    if (isLoggedIn && currentUser) {
      if (dropdownName) dropdownName.textContent = currentUser.uname || '已登录';
      if (dropdownLevel) dropdownLevel.textContent = 'Lv.' + (currentUser.level || 0);
      if (dropdownAvatar && currentUser.face) {
        var avatarImg = document.createElement('img');
        avatarImg.src = currentUser.face;
        avatarImg.alt = '';
        avatarImg.onerror = function() { this.style.display = 'none'; };
        dropdownAvatar.innerHTML = '';
        dropdownAvatar.appendChild(avatarImg);
      }
      if (logoutBtn) logoutBtn.style.display = 'flex';
    }
  }

  function init() {
    initPageLoader();
    initBackToTop();
    initSearchBox();
    initSearchSuggestions();
    initVideoCards();
    initMobileMenu();
    initHeaderScroll();
    initUserDropdown();
    initImageErrorHandler();
    initImageLazyLoad();
    initLazyImages();
    initVideoPlayer();
    initVideoRetry();
    initDescriptionToggle();
    initRankingTabs();
    initPagination();
    highlightNav();
    initComments();
    initRelatedSlider();
    initSpaceLinks();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CampusBiliApp = {
    formatCount: formatCount,
    showToast: showToast,
    Toast: Toast,
    showLoading: showLoading,
    hideLoading: hideLoading,
    showEmptyState: showEmptyState,
    smoothScrollTo: smoothScrollTo,
    initVideoCards: initVideoCards,
    loadMoreRecommend: window.loadMoreRecommend
  };

})();
