// categories.js – Category management: list, add, edit, delete with reassignment
import { db } from './db.js';
import { ui } from './ui.js';
import { sanitize, validate } from './utils.js';

export async function init() {
  const container = document.getElementById('app-content');
  if (!container) return;

  ui.showSpinner();
  try {
    await renderCategoryList(container);
  } catch (err) {
    console.error(err);
    ui.toast('Failed to load categories.', 'error');
  } finally {
    ui.hideSpinner();
  }
}

export function destroy() {}

async function renderCategoryList(container) {
  const categories = await db.categories.toArray();
  // Get live product counts per category
  const counts = {};
  const products = await db.products.where('is_active').equals(1).toArray();
  products.forEach(p => {
    const cid = p.category_id;
    counts[cid] = (counts[cid] || 0) + 1;
  });

  container.innerHTML = `
    <div class="categories-page">
      <h2>Categories</h2>
      <div style="display:flex; justify-content:space-between; margin-bottom:var(--space-md);">
        <button id="add-category-btn" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Add Category</button>
      </div>
      <div id="categories-table-container"></div>
    </div>`;

  const tableContainer = document.getElementById('categories-table-container');

  function renderTable() {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description', render: val => val || '—' },
      { key: 'product_count', label: 'Products', render: (_, row) => counts[row.id] || 0 },
      { key: 'created_at', label: 'Created', render: val => val ? new Date(val).toLocaleDateString() : '' },
      { key: 'actions', label: '', render: (_, row) => `
        <button class="btn btn-ghost btn-sm edit-cat-btn" data-id="${row.id}"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost btn-sm delete-cat-btn" data-id="${row.id}"><i class="fa-solid fa-trash text-danger"></i></button>
      `}
    ];

    ui.renderTable({
      container: tableContainer,
      columns,
      data: categories,
      emptyMessage: 'No categories found.'
    });

    // Bind events
    tableContainer.querySelectorAll('.edit-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => openCategoryModal(categories.find(c => c.id === parseInt(btn.dataset.id))));
    });
    tableContainer.querySelectorAll('.delete-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteCategory(parseInt(btn.dataset.id)));
    });
  }

  document.getElementById('add-category-btn').addEventListener('click', () => openCategoryModal(null));

  renderTable();

  // Modal logic for add/edit
  function openCategoryModal(category = null) {
    const isEdit = !!category;
    ui.showModal({
      title: isEdit ? 'Edit Category' : 'Add Category',
      body: `
        <form id="category-form">
          <div class="form-group">
            <label class="form-label">Name *</label>
            <input type="text" name="name" class="form-input" value="${sanitize(category?.name || '')}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea name="description" class="form-textarea">${sanitize(category?.description || '')}</textarea>
          </div>
        </form>`,
      footer: `
        <button class="btn btn-secondary close-modal">Cancel</button>
        <button class="btn btn-primary" id="save-category-btn">${isEdit ? 'Update' : 'Save'}</button>
      `
    });

    document.getElementById('save-category-btn').addEventListener('click', async () => {
      const form = document.getElementById('category-form');
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      const rules = [{ field: 'name', type: 'required', message: 'Category name is required.' }];
      const validation = validate(rules, data);
      if (!validation.isValid) {
        ui.showFieldError('name', validation.errors.name);
        return;
      }

      try {
        if (isEdit) {
          await db.categories.update(category.id, { name: data.name, description: data.description });
          ui.toast('Category updated.', 'success');
        } else {
          await db.categories.add({ name: data.name, description: data.description, created_at: new Date().toISOString() });
          ui.toast('Category added.', 'success');
        }
        ui.closeModal();
        // Refresh list
        const updated = await db.categories.toArray();
        categories.length = 0;
        categories.push(...updated);
        renderTable();
      } catch (err) {
        ui.toast('Error saving category.', 'error');
      }
    });
  }

  async function confirmDeleteCategory(catId) {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    const productCount = counts[catId] || 0;

    if (productCount > 0) {
      // Show reassignment modal
      const allCategories = categories.filter(c => c.id !== catId);
      ui.showModal({
        title: 'Reassign Products',
        body: `
          <p>${productCount} active product(s) belong to <strong>${sanitize(cat.name)}</strong>. You must reassign them before deleting.</p>
          <div class="form-group">
            <label class="form-label">Move to Category</label>
            <select id="reassign-category" class="form-select">
              ${allCategories.map(c => `<option value="${c.id}">${sanitize(c.name)}</option>`).join('')}
            </select>
          </div>`,
        footer: `
          <button class="btn btn-secondary close-modal">Cancel</button>
          <button class="btn btn-danger" id="confirm-reassign-btn">Reassign & Delete</button>
        `
      });

      document.getElementById('confirm-reassign-btn').addEventListener('click', async () => {
        const newCatId = parseInt(document.getElementById('reassign-category').value);
        try {
          await db.transaction('rw', [db.products, db.categories, db.audit_logs], async () => {
            await db.products.where('category_id').equals(catId).modify({ category_id: newCatId });
            await db.categories.delete(catId);
          });
          ui.toast('Category deleted and products reassigned.', 'success');
          ui.closeModal();
          refreshCategories();
        } catch (err) {
          ui.toast('Failed to delete category.', 'error');
        }
      });
    } else {
      // Simple delete confirmation
      ui.showModal({
        title: 'Delete Category',
        body: `<p>Delete category <strong>${sanitize(cat.name)}</strong>? This action cannot be undone.</p>`,
        footer: `
          <button class="btn btn-secondary close-modal">Cancel</button>
          <button class="btn btn-danger" id="confirm-delete-btn">Delete</button>
        `
      });
      document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        await db.categories.delete(catId);
        ui.toast('Category deleted.', 'success');
        ui.closeModal();
        refreshCategories();
      });
    }
  }

  async function refreshCategories() {
    const updated = await db.categories.toArray();
    categories.length = 0;
    categories.push(...updated);
    // Recalculate counts
    const prods = await db.products.where('is_active').equals(1).toArray();
    for (const key in counts) delete counts[key];
    prods.forEach(p => { counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
    renderTable();
  }
}
