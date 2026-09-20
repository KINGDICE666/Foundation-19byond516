#define SCPNET_SEARCH_MAX_QUERY 80

/datum/computer_file/program/scpnet
	filename = "scpnet"
	filedesc = "SCPnet"
	program_icon_state = "generic"
	program_menu_icon = "globe"
	extended_desc = "Браузер общедоступных страниц SCPnet. Требует подключения к SCiPnet."
	size = 6
	requires_ntnet = TRUE
	available_on_ntnet = TRUE
	usage_flags = PROGRAM_ALL
	network_destination = "SCPnet"
	tgui_id = "NtosSCPnet"

	var/site_id
	var/slug
	var/search_query
	var/list/search_results = list()
	var/search_pending = FALSE
	var/search_error
	var/search_request = 0
	var/search_generation = 0

/datum/computer_file/program/scpnet/tgui_data(mob/user, datum/tgui/ui, datum/tgui_state/state)
	var/list/data = get_header_data()
	SSscpnet.last_used = world.time
	SSscpnet.refresh_index()
	if(length(search_results) && search_generation != SSscpnet.generation)
		search_generation = SSscpnet.generation
		for(var/list/entry as anything in search_results.Copy())
			if(!SSscpnet.has_page(entry["site_id"], entry["slug"]))
				search_results -= list(entry)
	if(site_id && !SSscpnet.has_page(site_id, slug))
		site_id = null
		slug = null
	var/cache_key = json_encode(list(site_id, slug))
	if(site_id)
		SSscpnet.request_page(site_id, slug)
	var/client/viewer = user.client
	data["available"] = SSscpnet.available
	data["loading"] = site_id ? !!SSscpnet.pending[cache_key] : SSscpnet.index_pending
	data["catalog"] = SSscpnet.catalog
	data["site"] = SSscpnet.sites[site_id]
	data["page"] = SSscpnet.pages[cache_key]
	data["slug"] = slug
	data["search"] = list(
		"query" = search_query,
		"results" = search_results,
		"pending" = search_pending,
		"error" = search_error,
	)
	data["login"] = list(
		"code" = viewer && viewer.scpnet_code_expires > world.time ? viewer.scpnet_code : null,
		"pending" = viewer?.scpnet_login_pending,
		"retry_seconds" = viewer ? max(0, Ceiling((viewer.scpnet_login_retry - world.time) / (1 SECONDS))) : 0,
		"error" = viewer?.scpnet_login_error,
	)
	return data

/datum/computer_file/program/scpnet/tgui_act(action, list/params, datum/tgui/ui, datum/tgui_state/state)
	if(..())
		return TRUE
	switch(action)
		if("login")
			SSscpnet.request_login(ui.user.client)
			return TRUE
		if("open")
			if(!SSscpnet.has_page(params["site_id"], params["slug"]))
				return TRUE
			site_id = params["site_id"]
			slug = params["slug"]
			SSscpnet.request_page(site_id, slug)
			return TRUE
		if("home")
			site_id = null
			slug = null
			search_query = null
			search_results = list()
			search_error = null
			return TRUE
		if("refresh")
			SSscpnet.force_refresh(site_id, slug)
			return TRUE
		if("search")
			search(params["query"])
			return TRUE

/datum/computer_file/program/scpnet/proc/search(raw_query)
	if(!istext(raw_query) || search_pending)
		return
	var/query = trim(raw_query)
	if(length_char(query) < 2 || length_char(query) > SCPNET_SEARCH_MAX_QUERY)
		search_error = "Введите от 2 до [SCPNET_SEARCH_MAX_QUERY] символов."
		return
	search_request++
	if(!SSscpnet.search(query, CALLBACK(src, PROC_REF(on_search), search_request)))
		search_error = "SCPnet занят. Попробуйте ещё раз."
		return
	search_query = query
	search_results = list()
	search_error = null
	search_pending = TRUE

/datum/computer_file/program/scpnet/proc/on_search(request_id, list/response)
	if(QDELETED(src) || !search_pending || search_request != request_id)
		return
	search_pending = FALSE
	var/list/found = SSscpnet.search_results(response)
	if(isnull(found))
		search_error = "Не удалось выполнить поиск."
	else
		search_results = found
		search_generation = SSscpnet.generation
		search_error = null
	if(computer)
		SStgui.update_uis(computer)

#undef SCPNET_SEARCH_MAX_QUERY
