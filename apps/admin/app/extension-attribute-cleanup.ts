/**
 * Browser security extensions can modify the server-rendered document before
 * React hydrates it. Keep this list deliberately narrow so real application
 * hydration mismatches are still reported during development.
 */
export const extensionAttributeCleanupScript = String.raw`
(() => {
  const isExtensionAttribute = (name) =>
    name === 'bis_skin_checked' ||
    name === 'bis_register' ||
    (name.startsWith('__processed_') && name.endsWith('__'));

  const cleanElement = (element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (isExtensionAttribute(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
  };

  const cleanTree = (root) => {
    if (!(root instanceof Element)) return;
    cleanElement(root);
    for (const element of root.querySelectorAll('*')) cleanElement(element);
  };

  cleanTree(document.documentElement);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        const name = record.attributeName;
        if (name && isExtensionAttribute(name)) record.target.removeAttribute(name);
        continue;
      }

      for (const node of record.addedNodes) cleanTree(node);
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  window.addEventListener(
    'load',
    () => window.setTimeout(() => observer.disconnect(), 5000),
    { once: true },
  );
})();
`;
