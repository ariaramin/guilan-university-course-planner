(function installDomTableExtractor() {
  function textOf(cell) {
    if (!cell) return '';
    if (typeof cell.cloneNode !== 'function') return (cell.textContent || '').trim().replace(/\s+/g, ' ');
    const clone = cell.cloneNode(true);
    for (const hidden of clone.querySelectorAll('.hidden, [style*="display: none"], [style*="display:none"]')) {
      hidden.remove();
    }
    return clone.textContent.trim().replace(/\s+/g, ' ');
  }

  function gatherTableElements(doc, framePath, result) {
    for (const table of doc.querySelectorAll('table')) {
      if (table.getClientRects().length === 0) continue;
      const domRows = [...table.rows];
      const sampleCells = domRows.length ? [...domRows[0].cells] : [];
      result.tables.push({
        type: 'table',
        element: table,
        framePath,
        rowCount: domRows.length,
        width: sampleCells.length
      });
    }

    for (const grid of doc.querySelectorAll('[role="grid"], [role="table"]')) {
      if (grid.tagName === 'TABLE' || grid.querySelector?.('table') || grid.getClientRects().length === 0) continue;
      const domRows = [...grid.querySelectorAll('[role="row"]')];
      const sampleCells = domRows.length ? [...domRows[0].querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')] : [];
      result.tables.push({
        type: 'grid',
        element: grid,
        framePath,
        rowCount: domRows.length,
        width: sampleCells.length
      });
    }

    [...doc.querySelectorAll('iframe')].forEach((frame, index) => {
      if (frame.getClientRects().length === 0) return;
      result.visibleFrames += 1;
      try {
        if (!frame.contentDocument) {
          result.unreadableFrames += 1;
          return;
        }
        gatherTableElements(frame.contentDocument, `${framePath}.${index}`, result);
      } catch {
        result.unreadableFrames += 1;
      }
    });
  }

  function visible(element) {
    return Boolean(element?.getClientRects?.().length);
  }

  function visiblyRendered(element) {
    if (!visible(element)) return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0');
  }

  function visitDocuments(doc, visitor) {
    visitor(doc);
    for (const frame of doc.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try {
        if (frame.contentDocument) visitDocuments(frame.contentDocument, visitor);
      } catch {
        // A cross-origin frame cannot contain the same-origin SADA course table.
      }
    }
  }

  function tableFingerprint(tables) {
    const input = tables.map(({ framePath, rows }) => [framePath, rows]).flat(3).join('\u001f');
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `table-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function normalizedHeader(value) {
    return String(value).replaceAll('ي', 'ی').replaceAll('ك', 'ک').replace(/\s+/g, ' ').trim();
  }

  const headerAliases = {
    title: ['نام درس', 'عنوان درس', 'درس'],
    instructor: ['نام استاد', 'استاد'],
    schedule: ['زمان کلاس', 'برنامه زمانی', 'برنامه زمانی کلاس', 'برنامه کلاس'],
    exam: ['زمان امتحان', 'تاریخ امتحان', 'مکان امتحان'],
    capacity: ['ظرفیت', 'ظرفیت باقیمانده', 'ظرفیت مانده'],
    degree: ['مقطع'],
    term: ['ترم'],
    tuition: ['شهریه'],
    gender: ['جنسیت مجاز', 'جنسیت'],
    courseId: ['کد درس'],
    units: ['تعداد واحد', 'واحد'],
  };

  function scoreRows(rows) {
    if (!rows || rows.length === 0) return { score: 0, hasTitle: false, hasSchedule: false };
    const headers = (rows[0] ?? []).map(normalizedHeader);
    let score = 0;
    let hasTitle = false;
    let hasSchedule = false;

    for (const header of headers) {
      if (headerAliases.title.includes(header)) { score += 20; hasTitle = true; }
      else if (headerAliases.schedule.includes(header)) { score += 20; hasSchedule = true; }
      else if (headerAliases.instructor.includes(header)) score += 10;
      else if (headerAliases.exam.includes(header)) score += 10;
      else if (headerAliases.capacity.includes(header)) score += 10;
      else if (headerAliases.degree.includes(header)) score += 10;
      else if (headerAliases.term.includes(header)) score += 10;
      else if (headerAliases.tuition.includes(header)) score += 10;
      else if (headerAliases.gender.includes(header)) score += 10;
      else if (headerAliases.courseId.includes(header)) score += 10;
      else if (headerAliases.units.includes(header)) score += 10;
    }

    if (hasTitle && hasSchedule) score += 15;
    if (headers.length >= 5 && headers.length <= 15) score += 5;
    if (rows.length > 1) score += 5;

    return { score, hasTitle, hasSchedule };
  }

  function findBestTable(gatheredResult) {
    let bestTable = null;
    let maxScore = -1;

    for (const table of gatheredResult.tables) {
      if (table.rowCount === 0) continue;

      let sampleRows = [];
      if (table.type === 'table') {
        sampleRows = [...table.element.rows].slice(0, 3).map((row) => [...row.cells].map(textOf));
      } else {
        sampleRows = [...table.element.querySelectorAll('[role="row"]')].slice(0, 3).map((row) =>
          [...row.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')].map(textOf)
        ).filter((row) => row.length);
      }

      const scoreResult = scoreRows(sampleRows);
      if (scoreResult.score > maxScore) {
        maxScore = scoreResult.score;
        bestTable = table;
      }
    }

    if (!bestTable || maxScore < 25) {
      return { selectorFound: false, rowCount: 0, confidence: 0, bestTable: null };
    }

    let rowCount = Math.max(0, bestTable.rowCount - 1);
    if (!rowCount) {
      const width = bestTable.width;
      rowCount = gatheredResult.tables
        .filter((table) => table !== bestTable && table.framePath === bestTable.framePath && table.width === width)
        .reduce((sum, table) => sum + table.rowCount, 0);
    }

    return { selectorFound: true, rowCount, confidence: maxScore, bestTable };
  }

  function rowsFromTable(table) {
    if (table.type === 'table') {
      return [...table.element.rows].map((row) => [...row.cells].map(textOf));
    }
    return [...table.element.querySelectorAll('[role="row"]')].map((row) =>
      [...row.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')].map(textOf)
    ).filter((row) => row.length);
  }

  globalThis.sadaDomExtractor = {
    checkTableReadiness(doc) {
      const result = { tables: [], visibleFrames: 0, unreadableFrames: 0 };
      gatherTableElements(doc, 'top', result);
      const status = findBestTable(result);
      return {
        selectorFound: status.selectorFound,
        rowCount: status.rowCount,
        loadingVisible: this.hasVisibleLoadingIndicator(doc)
      };
    },
    extractVisibleTables(doc) {
      const result = { tables: [], visibleFrames: 0, unreadableFrames: 0 };
      gatherTableElements(doc, 'top', result);
      const status = findBestTable(result);

      const extractedTables = [];
      let totalRowCount = 0;

      if (status.selectorFound) {
        const parts = result.tables.filter((table) =>
          table === status.bestTable ||
          (status.bestTable.rowCount - 1 <= 0 && table.framePath === status.bestTable.framePath && table.width === status.bestTable.width)
        );

        for (const part of parts) {
          const rows = rowsFromTable(part);
          if (rows.length) {
            extractedTables.push({ tableIndex: extractedTables.length, framePath: part.framePath, rows });
            totalRowCount += Math.max(0, rows.length - (part === status.bestTable ? 1 : 0));
          }
        }
      }

      return {
        visibleFrames: result.visibleFrames,
        unreadableFrames: result.unreadableFrames,
        tables: extractedTables,
        totalRowCount: status.selectorFound ? status.rowCount : 0,
        selectorFound: status.selectorFound,
        rowCount: status.rowCount,
        confidence: status.confidence,
        fingerprint: tableFingerprint(extractedTables),
      };
    },
    extractAllVisibleTables(doc) {
      const result = { tables: [], visibleFrames: 0, unreadableFrames: 0 };
      gatherTableElements(doc, 'top', result);
      const tables = result.tables.map((table, tableIndex) => ({
        tableIndex,
        framePath: table.framePath,
        rows: rowsFromTable(table),
      })).filter((table) => table.rows.length);
      return { ...result, tables, fingerprint: tableFingerprint(tables) };
    },
    hasVisibleLoadingIndicator(doc) {
      let loading = false;
      visitDocuments(doc, (current) => {
        if (loading) return;
        loading = [...current.querySelectorAll('[aria-busy="true"], .loading, .mat-spinner, .mat-progress-spinner')].some(visiblyRendered);
      });
      return loading;
    },
    observationRoots(doc) {
      const roots = new Set();
      visitDocuments(doc, (current) => {
        const tables = [...current.querySelectorAll('table, [role="grid"], [role="table"]')].filter(visible);
        for (const table of tables) {
          roots.add(table.closest?.('form, [role="tabpanel"], .mat-tab-body-content, .table-responsive, .grid-container')
            || table.parentElement || table);
        }
        const frameContainer = current.querySelector?.('#freamContent');
        if (frameContainer) roots.add(frameContainer);
        if (!tables.length && current.body) roots.add(current.body);
      });
      return [...roots];
    },
  };
})();
