import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Button,
  TextInput,
  ScrollView,
  Alert,
  TouchableOpacity,
} from "react-native";
import * as SQLite from "expo-sqlite";
import { StatusBar } from "expo-status-bar";

const db = SQLite.openDatabase("finance.db");

/* ========= DB helpers ========= */
function execSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, res) => resolve(res),
        (_, err) => {
          console.log("SQL error:", err);
          reject(err);
          return false;
        }
      );
    });
  });
}

async function initDb() {
  await execSql(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    institution TEXT,
    type TEXT CHECK(type IN ('checking','savings','credit','cash','other')) DEFAULT 'other'
  );`);
  await execSql(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    kind TEXT CHECK(kind IN ('expense','income','transfer')) DEFAULT 'expense',
    is_fixed INTEGER DEFAULT 0
  );`);
  await execSql(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tdate TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    kind TEXT CHECK(kind IN ('expense','income','transfer')) NOT NULL,
    account_id INTEGER NOT NULL,
    category_id INTEGER,
    note TEXT
  );`);
  await execSql(`CREATE TABLE IF NOT EXISTS settings (
    skey TEXT PRIMARY KEY,
    svalue TEXT
  );`);
  await execSql(`CREATE TABLE IF NOT EXISTS fixed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    day INTEGER NOT NULL,
    category_id INTEGER
  );`);

  // seeds
  await execSql(
    `INSERT OR IGNORE INTO accounts(name,institution,type) VALUES (?,?,?)`,
    ["Conta Padrão", "Manual", "other"]
  );
  const seeds = [
    ["Aluguel/Condomínio", "expense", 1],
    ["Internet", "expense", 1],
    ["Energia", "expense", 1],
    ["Mercado", "expense", 0],
    ["Transporte", "expense", 0],
    ["Lazer", "expense", 0],
    ["Salário", "income", 0],
    ["Outros", "expense", 0],
  ];
  for (const [n, k, f] of seeds) {
    await execSql(
      `INSERT OR IGNORE INTO categories(name,kind,is_fixed) VALUES (?,?,?)`,
      [n, k, f]
    );
  }
}

/* ========= Utils ========= */
function Space() {
  return <View style={{ height: 10 }} />;
}
function money(v) {
  return "R$ " + Number(v || 0).toFixed(2);
}
function Row({ k, v }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 6,
      }}
    >
      <Text style={{ fontSize: 16 }}>{k}</Text>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>{v}</Text>
    </View>
  );
}
function TabButton({ title, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ padding: 10, borderBottomWidth: active ? 2 : 0 }}
    >
      <Text style={{ fontWeight: active ? "700" : "400" }}>{title}</Text>
    </TouchableOpacity>
  );
}
function useForce() {
  const [n, setN] = useState(0);
  return [n, () => setN((x) => x + 1)];
}

/* ========= Settings helpers ========= */
async function getSetting(key, def = "0") {
  const r = await execSql(`SELECT svalue FROM settings WHERE skey=?`, [key]);
  return r.rows.length ? r.rows.item(0).svalue : def;
}
async function setSetting(key, val) {
  await execSql(
    `INSERT INTO settings(skey,svalue) VALUES(?,?) 
     ON CONFLICT(skey) DO UPDATE SET svalue=excluded.svalue`,
    [key, String(val)]
  );
}

/* ========= Month ranges & summary ========= */
async function getMonthRangeISO(d = new Date()) {
  const y = d.getFullYear(),
    m = d.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const toISO = (x) => x.toISOString().slice(0, 10);
  return { start: toISO(start), end: toISO(end) };
}

async function monthSummary() {
  const { start, end } = await getMonthRangeISO(new Date());
  const r = await execSql(
    `SELECT t.*, c.is_fixed as cat_fixed
     FROM transactions t 
     LEFT JOIN categories c ON c.id=t.category_id
     WHERE tdate >= ? AND tdate <= ?`,
    [start, end]
  );
  let income = 0,
    expense = 0,
    fixedSpent = 0,
    variableSpent = 0;
  for (let i = 0; i < r.rows.length; i++) {
    const row = r.rows.item(i);
    if (row.kind === "income") income += row.amount;
    if (row.kind === "expense") {
      const v = Math.abs(row.amount);
      expense += v;
      if (row.cat_fixed === 1) fixedSpent += v;
      else variableSpent += v;
    }
  }
  const Y = parseFloat(await getSetting("fixed_monthly_budget", "0")) || 0;
  const variableBudget = Math.max(0, income - Y);
  const variableRemaining = variableBudget - variableSpent;
  return {
    income,
    expense,
    savings: income - expense,
    Y,
    fixedSpent,
    variableSpent,
    variableBudget,
    variableRemaining,
  };
}

/* ========= Helpers de histórico/CRUD ========= */
async function monthRange() {
  const d = new Date();
  const y = d.getFullYear(),
    m = d.getMonth();
  const start = new Date(y, m, 1).toISOString().slice(0, 10);
  const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

async function listMonthTransactions() {
  const { start, end } = await monthRange();
  const r = await execSql(
    `
    SELECT t.id, t.tdate, t.description, t.amount, t.kind,
           a.name AS account, c.name AS category, c.is_fixed AS cat_fixed
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.tdate >= ? AND t.tdate <= ?
    ORDER BY t.tdate DESC, t.id DESC
  `,
    [start, end]
  );
  const arr = [];
  for (let i = 0; i < r.rows.length; i++) arr.push(r.rows.item(i));
  return arr;
}

async function deleteTransaction(id) {
  await execSql(`DELETE FROM transactions WHERE id = ?`, [id]);
}

async function updateTransaction({
  id,
  tdate,
  description,
  amount,
  kind,
  categoryName,
}) {
  const acc = await execSql(`SELECT id FROM accounts WHERE name = ?`, [
    "Conta Padrão",
  ]);
  const accId = acc.rows.item(0).id;

  let catId = null;
  if (categoryName) {
    const r = await execSql(`SELECT id FROM categories WHERE name = ?`, [
      categoryName,
    ]);
    if (r.rows.length) catId = r.rows.item(0).id;
  }

  await execSql(
    `
    UPDATE transactions
       SET tdate=?, description=?, amount=?, kind=?, account_id=?, category_id=?
     WHERE id=?
  `,
    [tdate, description, amount, kind, accId, catId, id]
  );
}

/* ========= Screens ========= */
function Dashboard() {
  const [sum, setSum] = useState(null);
  const refresh = async () => setSum(await monthSummary());
  useEffect(() => {
    refresh();
  }, []);
  if (!sum) return <Text style={{ padding: 16 }}>Carregando...</Text>;
  return (
    <ScrollView style={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Visão Geral (mês)</Text>
      <Space />
      <Row k="Entradas (X)" v={money(sum.income)} />
      <Row k="Saídas" v={money(sum.expense)} />
      <Row k="Saldo" v={money(sum.savings)} />
      <Row k="Fixo planejado (Y)" v={money(sum.Y)} />
      <Space />
      <Text style={{ fontSize: 18, fontWeight: "600" }}>Fixo vs Variável</Text>
      <Row k="Fixo realizado" v={money(sum.fixedSpent)} />
      <Row k="Variável planejado (X−Y)" v={money(sum.variableBudget)} />
      <Row k="Variável restante" v={money(sum.variableRemaining)} />
      <Space />
      <Button title="Atualizar" onPress={refresh} />
    </ScrollView>
  );
}

function QuickAdd() {
  const [desc, setDesc] = useState("");
  const [val, setVal] = useState("");
  theKindCheck();
  function theKindCheck() {}
  const [kind, setKind] = useState("expense");
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState("");
  const [force, refresh] = useForce();

  useEffect(() => {
    (async () => {
      const r = await execSql(`SELECT * FROM categories ORDER BY name`);
      const arr = [];
      for (let i = 0; i < r.rows.length; i++) arr.push(r.rows.item(i));
      setCats(arr);
      setCat(arr.length ? arr[0].name : "");
    })();
  }, [force]);

  const submit = async () => {
    const amount = Number(String(val).replace(",", ".") || 0);
    if (!amount || !desc.trim()) {
      Alert.alert("Atenção", "Preencha descrição e valor.");
      return;
    }
    const acc = await execSql(`SELECT id FROM accounts WHERE name=?`, [
      "Conta Padrão",
    ]);
    const accId = acc.rows.item(0).id;
    let catId = null;
    if (cat) {
      const r = await execSql(`SELECT id FROM categories WHERE name=?`, [cat]);
      if (r.rows.length) catId = r.rows.item(0).id;
    }
    const today = new Date().toISOString().slice(0, 10);
    await execSql(
      `INSERT INTO transactions(tdate,description,amount,kind,account_id,category_id,note)
       VALUES (?,?,?,?,?,?,?)`,
      [
        today,
        desc.trim(),
        kind === "expense" ? -Math.abs(amount) : Math.abs(amount),
        kind,
        accId,
        catId,
        "",
      ]
    );
    setDesc("");
    setVal("");
    Alert.alert("OK", "Lançamento adicionado.");
  };

  return (
    <ScrollView style={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Novo Lançamento</Text>
      <Space />
      <Text>Descrição</Text>
      <TextInput
        value={desc}
        onChangeText={setDesc}
        placeholder="Ex.: Mercado, Uber, Salário"
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Space />
      <Text>Valor</Text>
      <TextInput
        value={val}
        onChangeText={setVal}
        keyboardType="decimal-pad"
        placeholder="0,00"
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Space />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          title={kind === "expense" ? "Despesa ✅" : "Despesa"}
          onPress={() => setKind("expense")}
        />
        <View style={{ width: 8 }} />
        <Button
          title={kind === "income" ? "Receita ✅" : "Receita"}
          onPress={() => setKind("income")}
        />
      </View>
      <Space />
      <Text>Categoria</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginVertical: 8 }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {cats.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => setCat(c.name)}
              style={{
                padding: 8,
                borderWidth: 1,
                backgroundColor: cat === c.name ? "#ddd" : "#fff",
              }}
            >
              <Text>
                {c.name}
                {c.is_fixed ? " (fixa)" : ""}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <Button title="Adicionar" onPress={submit} />
      <Space />
      <Button title="Recarregar categorias" onPress={refresh} />
    </ScrollView>
  );
}

function Categories() {
  const [list, setList] = useState([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("expense");
  const [isFixed, setIsFixed] = useState(false);

  const load = async () => {
    const r = await execSql(`SELECT * FROM categories ORDER BY name`);
    const arr = [];
    for (let i = 0; i < r.rows.length; i++) arr.push(r.rows.item(i));
    setList(arr);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!name.trim()) return;
    await execSql(
      `INSERT OR REPLACE INTO categories(name,kind,is_fixed) VALUES (?,?,?)`,
      [name.trim(), kind, isFixed ? 1 : 0]
    );
    setName("");
    setIsFixed(false);
    setKind("expense");
    await load();
  };

  return (
    <ScrollView style={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Categorias</Text>
      <Space />
      <Text>Nome</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Ex.: Internet, Mercado"
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Space />
      <Text>Tipo</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          title={kind === "expense" ? "expense ✅" : "expense"}
          onPress={() => setKind("expense")}
        />
        <View style={{ width: 8 }} />
        <Button
          title={kind === "income" ? "income ✅" : "income"}
          onPress={() => setKind("income")}
        />
        <View style={{ width: 8 }} />
        <Button
          title={kind === "transfer" ? "transfer ✅" : "transfer"}
          onPress={() => setKind("transfer")}
        />
      </View>
      <Space />
      <Button
        title={isFixed ? "É fixa ✅" : "É fixa ❌"}
        onPress={() => setIsFixed((v) => !v)}
      />
      <Space />
      <Button title="Adicionar/Atualizar" onPress={save} />
      <Space />
      {list.map((c) => (
        <View key={c.id} style={{ borderBottomWidth: 1, paddingVertical: 6 }}>
          <Text>
            {c.name} — {c.kind} — fixa: {c.is_fixed ? "sim" : "não"}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Fixos() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [val, setVal] = useState("");
  const [day, setDay] = useState("");
  const [catList, setCatList] = useState([]);
  const [cat, setCat] = useState("");

  const load = async () => {
    const r = await execSql(
      `SELECT f.*, c.name as category 
       FROM fixed_items f 
       LEFT JOIN categories c ON c.id=f.category_id 
       ORDER BY day`
    );
    const arr = [];
    for (let i = 0; i < r.rows.length; i++) arr.push(r.rows.item(i));
    setItems(arr);

    const c = await execSql(
      `SELECT * FROM categories WHERE kind='expense' ORDER BY name`
    );
    const cl = [];
    for (let i = 0; i < c.rows.length; i++) cl.push(c.rows.item(i));
    setCatList(cl);
    setCat(cl.length ? cl[0].name : "");
  };
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!name.trim() || !val || !day) {
      Alert.alert("Atenção", "Preencha nome, valor e dia.");
      return;
    }
    const amount = Number(String(val).replace(",", ".") || 0);
    if (amount <= 0) {
      Alert.alert("Atenção", "Valor deve ser > 0.");
      return;
    }
    const r = await execSql(`SELECT id FROM categories WHERE name=?`, [cat]);
    const catId = r.rows.length ? r.rows.item(0).id : null;
    await execSql(
      `INSERT INTO fixed_items(name,amount,day,category_id) VALUES (?,?,?,?)`,
      [name.trim(), amount, parseInt(day), catId]
    );
    setName("");
    setVal("");
    setDay("");
    await load();
  };

  const generateMonth = async () => {
    const acc = await execSql(`SELECT id FROM accounts WHERE name=?`, [
      "Conta Padrão",
    ]);
    const accId = acc.rows.item(0).id;
    const now = new Date();
    const y = now.getFullYear(),
      m = now.getMonth() + 1;
    for (const it of items) {
      const d = String(it.day).padStart(2, "0");
      const tdate = `${y}-${String(m).padStart(2, "0")}-${d}`;
      await execSql(
        `INSERT INTO transactions(tdate,description,amount,kind,account_id,category_id,note)
         VALUES (?,?,?,?,?,?,?)`,
        [
          tdate,
          it.name,
          -Math.abs(it.amount),
          "expense",
          accId,
          it.category_id,
          "fixo",
        ]
      );
    }
    Alert.alert("OK", "Fixos gerados para o mês atual.");
  };

  return (
    <ScrollView style={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Fixos do Mês</Text>
      <Space />
      <Text>Nome</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Ex.: Aluguel"
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Space />
      <Text>Valor</Text>
      <TextInput
        value={val}
        onChangeText={setVal}
        keyboardType="decimal-pad"
        placeholder="0,00"
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Space />
      <Text>Dia do mês (1-28/30/31)</Text>
      <TextInput
        value={day}
        onChangeText={setDay}
        keyboardType="number-pad"
        placeholder="5"
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Space />
      <Text>Categoria</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginVertical: 8 }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {catList.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => setCat(c.name)}
              style={{
                padding: 8,
                borderWidth: 1,
                backgroundColor: cat === c.name ? "#ddd" : "#fff",
              }}
            >
              <Text>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <Button title="Adicionar item fixo" onPress={add} />
      <Space />
      <Button title="Gerar fixos para o mês" onPress={generateMonth} />
      <Space />
      {items.map((it) => (
        <View key={it.id} style={{ borderBottomWidth: 1, paddingVertical: 6 }}>
          <Text>
            {it.day} — {it.name} — {money(it.amount)} —{" "}
            {it.category || "Sem categoria"}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

/* ========= Histórico (listar/editar/excluir) ========= */
function Historico() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => setItems(await listMonthTransactions());
  useEffect(() => {
    load();
  }, []);

  const askDelete = (id) => {
    Alert.alert("Excluir", "Deseja excluir este lançamento?", [
      { text: "Cancelar" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          await deleteTransaction(id);
          await load();
        },
      },
    ]);
  };

  const startEdit = (it) => {
    setEditing({
      id: it.id,
      tdate: it.tdate,
      description: it.description,
      amount: Number(it.amount),
      kind: it.kind,
      category: it.category || "",
    });
  };

  const saveEdit = async () => {
    const e = editing;
    if (!e.description || !e.tdate) {
      Alert.alert("Atenção", "Preencha data e descrição.");
      return;
    }
    const amt =
      e.kind === "expense"
        ? -Math.abs(Number(e.amount || 0))
        : Math.abs(Number(e.amount || 0));
    await updateTransaction({
      id: e.id,
      tdate: e.tdate,
      description: e.description.trim(),
      amount: amt,
      kind: e.kind,
      categoryName: e.category || null,
    });
    setEditing(null);
    await load();
  };

  return (
    <ScrollView style={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>
        Histórico (mês atual)
      </Text>
      <View style={{ height: 10 }} />

      {items.map((it) => (
        <View key={it.id} style={{ borderBottomWidth: 1, paddingVertical: 8 }}>
          <Text style={{ fontWeight: "600" }}>
            {it.tdate} — {it.description}
          </Text>
          <Text>{it.category || "Sem categoria"}</Text>
          <Text style={{ color: it.amount < 0 ? "crimson" : "green" }}>
            {it.kind}: {money(it.amount)}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Button title="Editar" onPress={() => startEdit(it)} />
            <View style={{ width: 8 }} />
            <Button
              title="Excluir"
              color="crimson"
              onPress={() => askDelete(it.id)}
            />
          </View>
        </View>
      ))}

      {editing && (
        <View style={{ marginTop: 16, padding: 12, borderWidth: 1, borderRadius: 6 }}>
          <Text style={{ fontSize: 18, fontWeight: "600" }}>
            Editar lançamento
          </Text>
          <View style={{ height: 8 }} />
          <Text>Data (YYYY-MM-DD)</Text>
          <TextInput
            value={editing.tdate}
            onChangeText={(v) => setEditing({ ...editing, tdate: v })}
            style={{ borderWidth: 1, padding: 8 }}
          />
          <View style={{ height: 8 }} />
          <Text>Descrição</Text>
          <TextInput
            value={editing.description}
            onChangeText={(v) => setEditing({ ...editing, description: v })}
            style={{ borderWidth: 1, padding: 8 }}
          />
          <View style={{ height: 8 }} />
          <Text>Valor</Text>
          <TextInput
            value={String(editing.amount)}
            keyboardType="decimal-pad"
            onChangeText={(v) => setEditing({ ...editing, amount: v })}
            style={{ borderWidth: 1, padding: 8 }}
          />
          <View style={{ height: 8 }} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              title={editing.kind === "expense" ? "Despesa ✅" : "Despesa"}
              onPress={() => setEditing({ ...editing, kind: "expense" })}
            />
            <View style={{ width: 8 }} />
            <Button
              title={editing.kind === "income" ? "Receita ✅" : "Receita"}
              onPress={() => setEditing({ ...editing, kind: "income" })}
            />
          </View>
          <View style={{ height: 8 }} />
          <Text>Categoria (igual ao nome cadastrado)</Text>
          <TextInput
            value={editing.category}
            onChangeText={(v) => setEditing({ ...editing, category: v })}
            style={{ borderWidth: 1, padding: 8 }}
            placeholder="Ex.: Mercado"
          />
          <View style={{ height: 8 }} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Salvar" onPress={saveEdit} />
            <View style={{ width: 8 }} />
            <Button title="Cancelar" color="gray" onPress={() => setEditing(null)} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Config() {
  const [y, setY] = useState("0");
  useEffect(() => {
    (async () => {
      const cur = await getSetting("fixed_monthly_budget", "0");
      setY(String(cur));
    })();
  }, []);
  const save = async () => {
    await setSetting("fixed_monthly_budget", y || "0");
    Alert.alert("OK", "Orçamento fixo salvo.");
  };
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Configurações</Text>
      <Space />
      <Text>Orçamento fixo mensal (Y)</Text>
      <TextInput
        value={y}
        onChangeText={setY}
        keyboardType="decimal-pad"
        placeholder="0,00"
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Space />
      <Button title="Salvar" onPress={save} />
    </View>
  );
}

/* ========= App (tabs) ========= */
export default function App() {
  const [tab, setTab] = useState("dash");
  useEffect(() => {
    initDb();
  }, []);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-around",
          padding: 8,
          borderBottomWidth: 1,
        }}
      >
        <TabButton
          title="Dashboard"
          active={tab === "dash"}
          onPress={() => setTab("dash")}
        />
        <TabButton
          title="Lançar"
          active={tab === "add"}
          onPress={() => setTab("add")}
        />
        <TabButton
          title="Categorias"
          active={tab === "cat"}
          onPress={() => setTab("cat")}
        />
        <TabButton
          title="Fixos"
          active={tab === "fix"}
          onPress={() => setTab("fix")}
        />
        <TabButton
          title="Histórico"
          active={tab === "hist"}
          onPress={() => setTab("hist")}
        />
        <TabButton
          title="Config"
          active={tab === "cfg"}
          onPress={() => setTab("cfg")}
        />
      </View>

      <View style={{ flex: 1 }}>
        {tab === "dash" && <Dashboard />}
        {tab === "add" && <QuickAdd />}
        {tab === "cat" && <Categories />}
        {tab === "fix" && <Fixos />}
        {tab === "hist" && <Historico />}
        {tab === "cfg" && <Config />}
      </View>
    </SafeAreaView>
  );
}
