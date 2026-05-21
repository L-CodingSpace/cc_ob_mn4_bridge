property appProcessName : "MarginNote 4"
property maxDepth : 8

on run
	tell application "System Events"
		if not (exists process appProcessName) then
			error "未找到进程：" & appProcessName
		end if
		
		tell process appProcessName
			set frontmost to true
			my dumpElement(it, 0)
		end tell
	end tell
end run

on dumpElement(rootElement, depth)
	if depth is greater than maxDepth then return
	
	tell application "System Events"
		try
			set roleText to ""
			set nameText to ""
			set descriptionText to ""
			set valueText to ""
			
			try
				set roleText to role of rootElement
			end try
			try
				set nameText to name of rootElement
			end try
			try
				set descriptionText to description of rootElement
			end try
			try
				set valueText to value of rootElement
			end try
			
			log my indentText(depth) & roleText & " | name=[" & nameText & "] | desc=[" & descriptionText & "] | value=[" & valueText & "]"
			
			set childElements to UI elements of rootElement
			repeat with childElement in childElements
				my dumpElement(childElement, depth + 1)
			end repeat
		end try
	end tell
end dumpElement

on indentText(depth)
	set outputText to ""
	repeat depth times
		set outputText to outputText & "  "
	end repeat
	return outputText
end indentText
