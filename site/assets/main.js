(() => {
  const motionPreference =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false };
  const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
  const easeInOut = "cubic-bezier(0.77, 0, 0.175, 1)";

  function play(element, keyframes, options) {
    if (motionPreference.matches || typeof element.animate !== "function")
      return null;

    try {
      const animation = element.animate(keyframes, options);
      animation.onfinish = () => animation.cancel();
      return animation;
    } catch {
      return null;
    }
  }

  function initializeHero() {
    const hero = document.querySelector(".hero");
    if (!hero || motionPreference.matches) return;

    const supportingCopy = [
      hero.querySelector(".hero-kicker"),
      hero.querySelector(".hero-summary"),
      hero.querySelector(".hero-actions"),
    ].filter(Boolean);
    const proof = hero.querySelector(".hero-proof");
    const animations = [];

    supportingCopy.forEach((element, index) => {
      const animation = play(
        element,
        [
          { opacity: 0, transform: "translateY(10px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: 400,
          delay: index * 50,
          easing: easeOut,
          fill: "both",
        },
      );
      if (animation) animations.push(animation);
    });

    if (proof) {
      const animation = play(
        proof,
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 500, delay: 100, easing: easeOut, fill: "both" },
      );
      if (animation) animations.push(animation);
    }

    window.addEventListener("pagehide", () => {
      animations.forEach((animation) => animation.cancel());
    });
  }

  function initializePipeline() {
    const pipeline = document.querySelector("[data-pipeline]");
    if (!pipeline) return;

    const tabs = Array.from(pipeline.querySelectorAll('[role="tab"]'));
    const panel = pipeline.querySelector('[role="tabpanel"]');
    const indicator = pipeline.querySelector(".stage-indicator");
    const track = pipeline.querySelector(".pipeline-track");
    const number = pipeline.querySelector("#pipeline-number");
    const title = pipeline.querySelector("#pipeline-title");
    const description = pipeline.querySelector("#pipeline-description");
    const output = pipeline.querySelector("#pipeline-output");
    if (
      !tabs.length ||
      !panel ||
      !indicator ||
      !track ||
      !number ||
      !title ||
      !description ||
      !output
    )
      return;

    let activeTab =
      tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ||
      tabs[0];
    let indicatorAnimation = null;
    let panelAnimation = null;
    let indicatorWidth = 0;

    function positionIndicator(tab, animate) {
      const tabBounds = tab.getBoundingClientRect();
      const trackBounds = track.getBoundingClientRect();
      if (!indicatorWidth && tabBounds.width > 0) {
        indicatorWidth = tabBounds.width;
        indicator.style.width = `${indicatorWidth}px`;
        indicator.style.transformOrigin = "left center";
      }

      const scale = indicatorWidth > 0 ? tabBounds.width / indicatorWidth : 1;
      const nextTransform = `translateX(${tabBounds.left - trackBounds.left}px) scaleX(${scale})`;
      const currentTransform = indicatorAnimation
        ? window.getComputedStyle(indicator).transform
        : indicator.style.transform || nextTransform;

      if (indicatorAnimation) indicatorAnimation.cancel();
      indicator.style.transform = nextTransform;
      indicatorAnimation =
        animate && currentTransform !== nextTransform
          ? play(
              indicator,
              [{ transform: currentTransform }, { transform: nextTransform }],
              { duration: 240, easing: easeInOut },
            )
          : null;
    }

    function selectTab(tab, moveFocus, animate = true) {
      const currentOpacity = panelAnimation
        ? window.getComputedStyle(panel).opacity
        : "0";
      const currentTransform = panelAnimation
        ? window.getComputedStyle(panel).transform
        : "translateY(8px)";
      if (panelAnimation) panelAnimation.cancel();

      activeTab = tab;
      tabs.forEach((candidate) => {
        const selected = candidate === tab;
        candidate.setAttribute("aria-selected", String(selected));
        candidate.tabIndex = selected ? 0 : -1;
      });

      panel.setAttribute("aria-labelledby", tab.id);
      number.textContent = tab.dataset.number || "";
      title.textContent = tab.dataset.title || "";
      description.textContent = tab.dataset.description || "";
      output.textContent = tab.dataset.output || "";
      positionIndicator(tab, animate);

      panelAnimation = animate
        ? play(
            panel,
            [
              { opacity: currentOpacity, transform: currentTransform },
              { opacity: "1", transform: "none" },
            ],
            { duration: 220, easing: easeOut },
          )
        : null;
      if (moveFocus) tab.focus();
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectTab(tab, false));
      tab.addEventListener("keydown", (event) => {
        let nextIndex;
        if (event.key === "ArrowRight" || event.key === "ArrowDown")
          nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp")
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex === undefined) return;

        event.preventDefault();
        selectTab(tabs[nextIndex], true);
      });
    });

    selectTab(activeTab, false, false);

    if (typeof window.ResizeObserver === "function") {
      const observer = new window.ResizeObserver(() =>
        positionIndicator(activeTab, false),
      );
      observer.observe(track);
      tabs.forEach((tab) => observer.observe(tab));
      window.addEventListener("pagehide", () => observer.disconnect());
    }

    window.addEventListener("pagehide", () => {
      if (indicatorAnimation) indicatorAnimation.cancel();
      if (panelAnimation) panelAnimation.cancel();
    });
  }

  async function copyText(text, button) {
    if (
      window.navigator.clipboard &&
      typeof window.navigator.clipboard.writeText === "function"
    ) {
      try {
        await window.navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Use the selection fallback when permission or a secure context is unavailable.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied =
        typeof document.execCommand === "function" &&
        document.execCommand("copy");
    } catch {
      copied = false;
    }

    textarea.remove();
    button.focus({ preventScroll: true });
    return copied;
  }

  function initializeCopyButtons() {
    document.querySelectorAll("[data-copy]").forEach((button) => {
      const label = button.querySelector("[data-copy-label]");
      if (!label) return;

      const copyLabel = label.textContent || "Copy";
      const copiedLabel = button.dataset.copiedLabel || "Copied";
      let resetTimer;
      let request = 0;
      label.setAttribute("aria-live", "polite");

      function resetLabel() {
        window.clearTimeout(resetTimer);
        label.textContent = copyLabel;
      }

      button.addEventListener("click", async () => {
        const currentRequest = ++request;
        window.clearTimeout(resetTimer);
        const copied = await copyText(button.dataset.copy || "", button);
        if (currentRequest !== request) return;

        label.textContent = copied ? copiedLabel : copyLabel;
        if (copied) resetTimer = window.setTimeout(resetLabel, 1600);
      });
      window.addEventListener("pagehide", resetLabel);
    });
  }

  initializeHero();
  initializePipeline();
  initializeCopyButtons();
})();
